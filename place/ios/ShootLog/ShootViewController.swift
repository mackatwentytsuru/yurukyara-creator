import ARKit
import AVFoundation
import SceneKit
import SwiftUI
import UIKit

struct ShootLogRepresentable: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ShootViewController { ShootViewController() }
    func updateUIViewController(_ uiViewController: ShootViewController, context: Context) {}
}

/// 撮影記録。iPhone のカメラで動画を撮りながら、コマごとのカメラの位置・向き・画角(ARKit)を記録する。
/// 流れ: ① 床を記録 → ② LED の 4 隅(左上→右上→右下→左下)に十字を合わせて記録 → ③ 録画。
/// 校正(①②)は同じ ARKit のセッションの中でやる(録画までに世界の原点が変わらないように、途中でアプリを閉じない)。
final class ShootViewController: UIViewController, ARSessionDelegate {
    private let sceneView = ARSCNView()
    private let frameQueue = DispatchQueue(label: "shootlog.frames", qos: .userInitiated)
    private let lock = NSLock()
    private var latestFrame: ARFrame?
    private var recorder: ShootRecorder?
    private var recordStartDate: Date?
    private var calibration = Calibration()
    private var events: [ShootEvent] = []
    private var lastTracking = "-"
    private var formats: [ARConfiguration.VideoFormat] = []
    private var chosenFormat: ARConfiguration.VideoFormat?
    private var autoFocus = true
    private var lastDir: URL?
    private var exposureAtStart: ExposureInfo?
    private var notice: String?   // 保存・失敗のお知らせ(次の録画を始めるまで出す)

    private let stepLabel = UILabel()
    private let guideView = GuideView()
    private let previewLayer = AVSampleBufferDisplayLayer()
    private var previewCount = 0
    private let statusLabel = UILabel()
    private let calibButton = UIButton(type: .system)
    private let resetButton = UIButton(type: .system)
    private let recordButton = UIButton(type: .system)
    private let shareButton = UIButton(type: .system)
    private let formatControl = UISegmentedControl()
    private let ueLink = UELinkController()
    private let pcStream = PCStreamer()
    private let ueButton = UIButton(type: .system)
    private var crosshair: UIView?
    private let faceControl = UISegmentedControl(items: ["LED 1面", "LED 3面(A・B・C)"])
    private let focusSwitch = UISwitch()
    private let focusLabel = UILabel()
    private let exposureSwitch = UISwitch()
    private let exposureLabel = UILabel()
    private let isoSlider = UISlider()
    private let isoLabel = UILabel()
    private var exposureLocked = false
    private var isoValue: Float = 100
    private var clipPercent: Float = 0
    private var frameTick = 0
    private var timer: Timer?

    private static let cornerIds = ["tl", "tr", "br", "bl"]
    private static let cornerLabels = ["左上", "右上", "右下", "左下"]
    private static let faceNames = ["A", "B", "C"]   // 客席から見て左から A・B・C
    private var faceCount: Int { faceControl.selectedSegmentIndex == 0 ? 1 : 3 }
    private var totalCorners: Int { faceCount * 4 }

    private var isRecording: Bool {
        lock.lock(); defer { lock.unlock() }
        return recorder != nil
    }

    // MARK: - 画面

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        sceneView.frame = view.bounds
        sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sceneView.automaticallyUpdatesLighting = false
        sceneView.session.delegate = self
        sceneView.session.delegateQueue = frameQueue
        view.addSubview(sceneView)
        // カメラの映像は、ARSCNView 任せにせず、ARFrame の映像を自前で出す(ARSCNView が映さない端末・形式でも出る)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.insertSublayer(previewLayer, above: sceneView.layer)
        ueLink.webView.frame = view.bounds
        ueLink.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(ueLink.webView)
        ueLink.recorderInfo = { [weak self] in
            guard let self else { return nil }
            self.lock.lock(); defer { self.lock.unlock() }
            guard let r = self.recorder else { return nil }
            return (r.currentFrameCount, r.droppedCount)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(thermalChanged), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
        sceneView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(calibTapped)))

        addCrosshair()
        setupLabels()
        setupControls()
        pickFormats()
        refreshUI()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.refreshUI() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIApplication.shared.isIdleTimerDisabled = true
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted: notice = "カメラが許可されていない: 設定 → 撮影記録 → カメラ をオン"
        default: break
        }
        runSession(reset: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.applyLaunchArguments() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscapeRight }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    private func addCrosshair() {
        let size: CGFloat = 44
        let cross = UIView(frame: CGRect(x: 0, y: 0, width: size, height: size))
        cross.isUserInteractionEnabled = false
        crosshair = cross
        cross.translatesAutoresizingMaskIntoConstraints = false
        let path = UIBezierPath()
        path.move(to: CGPoint(x: size / 2, y: 0)); path.addLine(to: CGPoint(x: size / 2, y: size))
        path.move(to: CGPoint(x: 0, y: size / 2)); path.addLine(to: CGPoint(x: size, y: size / 2))
        let layer = CAShapeLayer()
        layer.path = path.cgPath
        layer.strokeColor = UIColor.systemYellow.cgColor
        layer.lineWidth = 2
        cross.layer.addSublayer(layer)
        view.addSubview(cross)
        NSLayoutConstraint.activate([
            cross.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cross.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            cross.widthAnchor.constraint(equalToConstant: size),
            cross.heightAnchor.constraint(equalToConstant: size),
        ])
    }

    private func setupLabels() {
        for (label, size) in [(stepLabel, CGFloat(20)), (statusLabel, CGFloat(13))] {
            label.numberOfLines = 0
            label.textColor = .white
            label.backgroundColor = UIColor.black.withAlphaComponent(0.55)
            label.font = .systemFont(ofSize: size, weight: size > 14 ? .semibold : .regular)
            label.layer.cornerRadius = 8
            label.clipsToBounds = true
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
        }
        guideView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(guideView)
        NSLayoutConstraint.activate([
            stepLabel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            stepLabel.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            stepLabel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.6),
            statusLabel.leadingAnchor.constraint(equalTo: stepLabel.leadingAnchor),
            statusLabel.topAnchor.constraint(equalTo: stepLabel.bottomAnchor, constant: 6),
            guideView.leadingAnchor.constraint(equalTo: stepLabel.leadingAnchor),
            guideView.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 6),
            guideView.widthAnchor.constraint(equalToConstant: 250),
            guideView.heightAnchor.constraint(equalToConstant: 118),
            statusLabel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.6),
        ])
    }

    private func styled(_ b: UIButton, _ title: String, _ color: UIColor) {
        b.setTitle(title, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        b.backgroundColor = color
        b.layer.cornerRadius = 10
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
        b.heightAnchor.constraint(equalToConstant: 48).isActive = true
    }

    private func setupControls() {
        styled(calibButton, "床を記録", .systemBlue)
        styled(resetButton, "校正をやり直す", .systemGray)
        styled(recordButton, "● 録画開始", .systemRed)
        styled(shareButton, "共有(AirDrop)", .systemGreen)
        calibButton.addTarget(self, action: #selector(calibTapped), for: .touchUpInside)
        resetButton.addTarget(self, action: #selector(resetTapped), for: .touchUpInside)
        recordButton.addTarget(self, action: #selector(recordTapped), for: .touchUpInside)
        shareButton.addTarget(self, action: #selector(shareTapped), for: .touchUpInside)

        styled(ueButton, "UE", .systemIndigo)
        ueButton.addTarget(self, action: #selector(ueTapped), for: .touchUpInside)
        let bar = UIStackView(arrangedSubviews: [calibButton, resetButton, recordButton, shareButton, ueButton])
        bar.axis = .horizontal
        bar.spacing = 8
        bar.distribution = .fillProportionally
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        faceControl.selectedSegmentIndex = 1
        faceControl.addTarget(self, action: #selector(faceChanged), for: .valueChanged)
        faceControl.translatesAutoresizingMaskIntoConstraints = false
        formatControl.addTarget(self, action: #selector(formatChanged), for: .valueChanged)
        formatControl.translatesAutoresizingMaskIntoConstraints = false
        focusLabel.text = "オートフォーカス"
        focusLabel.textColor = .white
        focusLabel.font = .systemFont(ofSize: 13)
        focusSwitch.isOn = true
        focusSwitch.addTarget(self, action: #selector(focusChanged), for: .valueChanged)
        let focusRow = UIStackView(arrangedSubviews: [focusLabel, focusSwitch])
        focusRow.spacing = 6
        exposureLabel.text = "露出・色・ピント固定(1/60)"
        exposureLabel.textColor = .white
        exposureLabel.font = .systemFont(ofSize: 13)
        exposureSwitch.isOn = false
        exposureSwitch.addTarget(self, action: #selector(exposureChanged), for: .valueChanged)
        let exposureRow = UIStackView(arrangedSubviews: [exposureLabel, exposureSwitch])
        exposureRow.spacing = 6
        isoSlider.minimumValue = 0
        isoSlider.maximumValue = 1
        isoSlider.isEnabled = false
        isoSlider.addTarget(self, action: #selector(isoSliderChanged), for: .valueChanged)
        isoSlider.widthAnchor.constraint(equalToConstant: 200).isActive = true
        isoLabel.text = "ISO -"
        isoLabel.textColor = .white
        isoLabel.font = .systemFont(ofSize: 13)
        let isoRow = UIStackView(arrangedSubviews: [isoLabel, isoSlider])
        isoRow.spacing = 6
        let side = UIStackView(arrangedSubviews: [faceControl, formatControl, focusRow, exposureRow, isoRow])
        side.axis = .vertical
        side.alignment = .trailing
        side.spacing = 6
        side.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        side.layoutMargins = UIEdgeInsets(top: 6, left: 6, bottom: 6, right: 6)
        side.isLayoutMarginsRelativeArrangement = true
        side.layer.cornerRadius = 8
        side.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(side)

        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            bar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8),
            bar.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -12),
            side.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8),
            side.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
        ])
    }

    // MARK: - 解像度・fps

    /// 取れる形式のうち、いちばん大きい 4K と、いちばん速い(fps 最大の中で大きい)形式を選べるようにする。
    private func pickFormats() {
        formats = ARWorldTrackingConfiguration.supportedVideoFormats
        var options: [ARConfiguration.VideoFormat] = []
        func add(_ f: ARConfiguration.VideoFormat?) {
            guard let f else { return }
            let same = options.contains { $0.imageResolution == f.imageResolution && $0.framesPerSecond == f.framesPerSecond }
            if !same { options.append(f) }
        }
        let pixels: (ARConfiguration.VideoFormat) -> CGFloat = { $0.imageResolution.width * $0.imageResolution.height }
        if #available(iOS 16.0, *) { add(ARWorldTrackingConfiguration.recommendedVideoFormatFor4KResolution) }
        add(formats.filter { $0.imageResolution.width >= 3800 }.max { $0.framesPerSecond < $1.framesPerSecond })
        let maxFps = formats.map(\.framesPerSecond).max() ?? 30
        add(formats.filter { $0.framesPerSecond == maxFps }.max { pixels($0) < pixels($1) })
        add(formats.max { pixels($0) < pixels($1) })
        if options.isEmpty { add(ARWorldTrackingConfiguration.supportedVideoFormats.first) }
        options.sort { pixels($0) > pixels($1) }
        formatOptions = options
        formatControl.removeAllSegments()
        for (i, f) in options.enumerated() {
            formatControl.insertSegment(withTitle: Self.title(f), at: i, animated: false)
        }
        formatControl.selectedSegmentIndex = options.isEmpty ? UISegmentedControl.noSegment : 0
        chosenFormat = options.first
    }

    private var formatOptions: [ARConfiguration.VideoFormat] = []

    private static func title(_ f: ARConfiguration.VideoFormat) -> String {
        "\(Int(f.imageResolution.width))×\(Int(f.imageResolution.height)) \(f.framesPerSecond)fps"
    }

    private static func info(_ f: ARConfiguration.VideoFormat) -> FormatInfo {
        FormatInfo(width: Int(f.imageResolution.width), height: Int(f.imageResolution.height),
                   fps: f.framesPerSecond, device: f.captureDeviceType.rawValue)
    }

    @objc private func formatChanged() {
        let i = formatControl.selectedSegmentIndex
        guard i >= 0, i < formatOptions.count, !isRecording else { return }
        chosenFormat = formatOptions[i]
        calibration = Calibration()
        runSession(reset: true)
    }

    @objc private func faceChanged() {
        guard !isRecording else { return }
        calibration = Calibration()
        refreshUI()
    }

    @objc private func focusChanged() {
        guard !isRecording else { focusSwitch.isOn = autoFocus; return }
        autoFocus = focusSwitch.isOn
        calibration = Calibration()
        runSession(reset: true)
    }

    private func runSession(reset: Bool) {
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        config.planeDetection = [.horizontal, .vertical]
        if let f = chosenFormat { config.videoFormat = f }
        config.isAutoFocusEnabled = autoFocus
        sceneView.session.run(config, options: reset ? [.resetTracking, .removeExistingAnchors] : [])
        logEvent(reset ? "session:run(reset)" : "session:run")
        if exposureLocked {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in self?.applyExposure(lockFromCurrent: false) }
        }
    }

    // MARK: - 露出・ホワイトバランス・ピントの固定

    private var captureDevice: AVCaptureDevice? { ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera }

    private func isoFromSlider() -> Float {
        guard let d = captureDevice else { return isoValue }
        let lo = d.activeFormat.minISO, hi = d.activeFormat.maxISO
        return lo * pow(hi / lo, isoSlider.value)
    }

    private func sliderFromISO(_ iso: Float, _ d: AVCaptureDevice) -> Float {
        let lo = d.activeFormat.minISO, hi = d.activeFormat.maxISO
        return min(max(log(iso / lo) / log(hi / lo), 0), 1)
    }

    @objc private func exposureChanged() {
        guard !isRecording else { exposureSwitch.isOn = exposureLocked; return }
        exposureLocked = exposureSwitch.isOn
        if exposureLocked {
            applyExposure(lockFromCurrent: true)
        } else {
            releaseExposure()
        }
        refreshUI()
    }

    @objc private func isoSliderChanged() {
        guard exposureLocked, !isRecording else { return }
        isoValue = isoFromSlider()
        applyExposure(lockFromCurrent: false)
    }

    /// シャッター 1/60 に固定し、ISO は画面で決める。ホワイトバランスとピントは、固定したときの値のまま。
    private func applyExposure(lockFromCurrent: Bool) {
        guard let d = captureDevice else { notice = "露出を固定できない(カメラの設定を取れない)"; return }
        do {
            try d.lockForConfiguration()
            defer { d.unlockForConfiguration() }
            if lockFromCurrent {
                isoValue = min(max(d.iso, d.activeFormat.minISO), d.activeFormat.maxISO)
                isoSlider.value = sliderFromISO(isoValue, d)
            }
            let shutter = CMTime(value: 1, timescale: 60)
            d.setExposureModeCustom(duration: shutter, iso: isoValue, completionHandler: nil)
            if lockFromCurrent {
                if d.isWhiteBalanceModeSupported(.locked) {
                    let g = d.deviceWhiteBalanceGains
                    let m = d.maxWhiteBalanceGain
                    let clamped = AVCaptureDevice.WhiteBalanceGains(
                        redGain: min(max(g.redGain, 1), m), greenGain: min(max(g.greenGain, 1), m), blueGain: min(max(g.blueGain, 1), m))
                    d.setWhiteBalanceModeLocked(with: clamped, completionHandler: nil)
                }
                if d.isFocusModeSupported(.locked) { d.focusMode = .locked }
            }
            logEvent("exposure:lock iso=\(Int(isoValue)) shutter=1/60")
        } catch {
            notice = "露出を固定できない: \(error.localizedDescription)"
        }
    }

    private func releaseExposure() {
        guard let d = captureDevice else { return }
        do {
            try d.lockForConfiguration()
            defer { d.unlockForConfiguration() }
            d.exposureMode = .continuousAutoExposure
            if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
            if autoFocus, d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
            logEvent("exposure:auto")
        } catch {
            notice = "露出を自動に戻せない: \(error.localizedDescription)"
        }
    }

    /// いまカメラが実際に使っている値(固定していれば固定した値)。meta.json に残す。
    private func currentExposureInfo() -> ExposureInfo? {
        guard let d = captureDevice else { return nil }
        let g = d.deviceWhiteBalanceGains
        return ExposureInfo(
            locked: exposureLocked, shutterSeconds: d.exposureDuration.seconds, iso: d.iso,
            exposureModeIsCustom: d.exposureMode == .custom, whiteBalanceLocked: d.whiteBalanceMode == .locked,
            whiteBalanceGains: [g.redGain, g.greenGain, g.blueGain], focusLocked: d.focusMode == .locked, lensPosition: d.lensPosition)
    }

    /// 白飛びの割合(輝度が 250 以上の画素の %)。間引いて数える。
    private func measureClip(_ frame: ARFrame) {
        let pb = frame.capturedImage
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return }
        let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        let p = base.assumingMemoryBound(to: UInt8.self)
        var hot = 0, total = 0
        var y = 0
        while y < h {
            var x = 0
            while x < w {
                if p[y * stride + x] >= 250 { hot += 1 }
                total += 1
                x += 24
            }
            y += 24
        }
        let pct = total > 0 ? Float(hot) * 100 / Float(total) : 0
        lock.lock(); clipPercent = pct; lock.unlock()
    }

    // MARK: - 校正

    @objc private func calibTapped() {
        guard let frame = currentFrame() else { return }
        let now = frame.timestamp
        if calibration.floor == nil {
            markFloor(frame, time: now)
        } else if calibration.corners.count < totalCorners {
            markCorner(frame, time: now)
        }
        refreshUI()
    }

    @objc private func resetTapped() {
        guard !isRecording else { return }
        calibration = Calibration()
        refreshUI()
    }

    private func centerRaycast(_ alignment: ARRaycastQuery.TargetAlignment) -> ARRaycastResult? {
        let center = CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)
        guard let q = sceneView.raycastQuery(from: center, allowing: .estimatedPlane, alignment: alignment) else { return nil }
        return sceneView.session.raycast(q).first
    }

    private func markFloor(_ frame: ARFrame, time: Double) {
        let planes: [PlaneInfo] = frame.anchors.compactMap { a in
            guard let p = a as? ARPlaneAnchor else { return nil }
            return PlaneInfo(
                id: p.identifier.uuidString,
                alignment: p.alignment == .horizontal ? "horizontal" : "vertical",
                T: Pack.flat(p.transform),
                extent: [p.planeExtent.width, p.planeExtent.height],
                center: Pack.flat(p.center)
            )
        }
        let hit = centerRaycast(.horizontal)
        let lowest = planes.filter { $0.alignment == "horizontal" }.map { $0.T[13] }.min()
        let hitPoint = hit.map { [$0.worldTransform.columns.3.x, $0.worldTransform.columns.3.y, $0.worldTransform.columns.3.z] }
        guard let planeY = hitPoint?[1] ?? lowest else {
            logEvent("floor:not-found")
            return
        }
        calibration.floor = FloorMark(sessionTime: time, point: hitPoint, planeY: planeY, camera: Pack.camera(frame), planes: planes)
        logEvent("floor:y=\(String(format: "%.3f", planeY))")
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    private func markCorner(_ frame: ARFrame, time: Double) {
        let count = calibration.corners.count
        let index = count % 4
        let face = Self.faceNames[count / 4]
        let t = frame.camera.transform
        let origin = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let forward = -simd_normalize(simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
        let hit = centerRaycast(.any)
        let hitPoint = hit.map { [$0.worldTransform.columns.3.x, $0.worldTransform.columns.3.y, $0.worldTransform.columns.3.z] }
        lock.lock()
        let videoFrame = recorder?.currentFrameCount
        lock.unlock()
        calibration.corners.append(CornerMark(
            id: Self.cornerIds[index], face: face, label: "面\(face) " + Self.cornerLabels[index], sessionTime: time, videoFrame: videoFrame,
            camera: Pack.camera(frame), rayOrigin: Pack.flat(origin), rayDirection: Pack.flat(forward),
            hit: hitPoint, hitKind: hit.map { $0.target == .estimatedPlane ? "estimatedPlane" : "plane" }
        ))
        logEvent("corner:\(face)_\(Self.cornerIds[index])")
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    // MARK: - 録画

    @objc private func recordTapped() {
        if isRecording { stopRecording() } else { startRecording() }
    }

    private func startRecording() {
        guard currentFrame() != nil else { return }
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.dateFormat = "yyyyMMdd-HHmmss"
        do {
            let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let dir = docs.appendingPathComponent("shoots/\(stamp.string(from: Date()))", isDirectory: true)
            let rec = try ShootRecorder(dir: dir, nominalFps: chosenFormat?.framesPerSecond ?? 30)
            lock.lock()
            recorder = rec
            recordStartDate = Date()
            events = events.filter { $0.kind.hasPrefix("floor") || $0.kind.hasPrefix("corner") || $0.kind.hasPrefix("session") }
            lock.unlock()
            lastDir = dir
            logEvent("thermal:\(UELinkController.thermalName(ProcessInfo.processInfo.thermalState))")   // 録画を始めたときの熱(最初の状態)
            if let free = try? docs.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage {
                logEvent("storage-free-bytes:\(free)")   // 録画を始めたときの端末の空き(本番の録画が入るかの確認用)
            }
            exposureAtStart = currentExposureInfo()
            notice = nil
            logEvent("record:start")
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        } catch {
            notice = "録画を始められない: \(error.localizedDescription)"
        }
        refreshUI()
    }

    private func stopRecording() {
        lock.lock()
        let rec = recorder
        let started = recordStartDate
        recorder = nil
        recordStartDate = nil
        lock.unlock()
        guard let rec else { return }
        logEvent("record:stop")
        let cal = calibration
        let fmt = chosenFormat.map(Self.info)
        let supported = formats.map(Self.info)
        let af = autoFocus
        let expStart = exposureAtStart
        let expEnd = currentExposureInfo()
        let ueSummary: UELinkSummary? = ueLink.enabled ? ueLink.summary() : nil
        let pcSummary: PCStreamSummary? = pcStream.enabled ? pcStream.summary() : nil
        frameQueue.async { [weak self] in
            rec.finish { stats in
                guard let self else { return }
                self.lock.lock()
                let evs = self.events
                self.lock.unlock()
                let iso = ISO8601DateFormatter().string(from: started ?? Date())
                var meta = ShootMeta(
                    startedAt: iso, device: Pack.deviceModel(), systemVersion: UIDevice.current.systemVersion,
                    chosenFormat: fmt, supportedFormats: supported, autoFocus: af, exposureAtStart: expStart, ueLink: ueSummary, exposureAtEnd: expEnd,
                    calibration: cal, events: evs, stats: stats, conventions: ShootMeta.conventionText
                )
                meta.pcStream = pcSummary
                let enc = JSONEncoder()
                enc.outputFormatting = [.prettyPrinted, .sortedKeys]
                try? enc.encode(meta).write(to: rec.dir.appendingPathComponent("meta.json"))
                DispatchQueue.main.async {
                    self.notice = "保存した: \(stats.frames) コマ、捨てたコマ \(stats.droppedFrames)、追跡が正常でないコマ \(stats.trackingNotNormalFrames)"
                    self.refreshUI()
                }
            }
        }
        refreshUI()
    }

    // MARK: - UE モニター・熱

    @objc private func ueTapped() {
        let panel = UELinkPanelViewController(link: ueLink, pc: pcStream) { [weak self] in
            guard let self else { return }
            self.crosshair?.isHidden = self.ueLink.enabled
            self.refreshUI()
        }
        present(panel, animated: true)
    }

    @objc private func thermalChanged() {
        logEvent("thermal:\(UELinkController.thermalName(ProcessInfo.processInfo.thermalState))")
    }

    /// 実機の調べ(--probe-multicam): (1) ARKit が動いたまま、超広角・望遠を別の仕組み(AVCaptureMultiCamSession)で動かすと、ARKit のコマが続くか。
    /// (2) ARKit を止めて、背面カメラの複数同時の組み合わせを全部測る。結果は Documents/multicam_probe.json。終わったらアプリを閉じる。
    private func runMultiCamProbe() {
        let probe = Probe()
        let devs = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInUltraWideCamera, .builtInTelephotoCamera], mediaType: .video, position: .back).devices
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var out: [String: Any] = ["model": Probe.modelName(), "system": UIDevice.current.systemVersion, "mode": "arkit-then-multicam"]
            var concurrent: [[String: Any]] = []
            for d in devs {
                self.lock.lock(); let ev0 = self.events.filter { $0.kind.hasPrefix("session:interrupted") }.count; self.lock.unlock()
                let f0 = self.frameTick
                let t0 = Date()
                var r = probe.runSet([d], tier: 1)
                let dt = Date().timeIntervalSince(t0)
                let f1 = self.frameTick
                self.lock.lock(); let ev1 = self.events.filter { $0.kind.hasPrefix("session:interrupted") }.count; self.lock.unlock()
                r["arkitFramesDuring"] = f1 - f0
                r["arkitFpsDuring"] = Double(f1 - f0) / max(dt, 0.1)
                r["arkitInterruptedDuring"] = ev1 - ev0
                r["camera"] = probe.name(d)
                concurrent.append(r)
                Thread.sleep(forTimeInterval: 3)
            }
            out["arkitRunningThenSecondSession"] = concurrent
            DispatchQueue.main.sync { self.sceneView.session.pause() }
            Thread.sleep(forTimeInterval: 1)
            out["multicam"] = probe.run { _ in }
            if let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true),
               let data = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: docs.appendingPathComponent("multicam_probe.json"))
            }
            exit(0)
        }
    }

    /// テスト用: 起動の引数で UE モニターを入れる(--ue-host H --ue-port P --ue-url U --ue-on --ue-latency --ue-test60)。
    private func applyLaunchArguments() {
        let a = ProcessInfo.processInfo.arguments
        func value(_ key: String) -> String? { a.firstIndex(of: key).flatMap { $0 + 1 < a.count ? a[$0 + 1] : nil } }
        if a.contains("--probe-multicam") { runMultiCamProbe(); return }
        if a.contains("--pc-on") {
            pcStream.codec = value("--pc-codec") ?? "jpeg"
            if let w = Int(value("--pc-width") ?? "") { pcStream.width = w }
            if let k = Int(value("--pc-kbps") ?? "") { pcStream.kbps = k }
            if let f = Double(value("--pc-fps") ?? "") { pcStream.targetFps = f }
            pcStream.setEnabled(true, host: value("--pc-host") ?? ueLink.config.host, port: Int(value("--pc-port") ?? "") ?? 9100)
        }
        // 同時の試験用: --auto-record 秒(校正なしで、5 秒後に録画を始め、その秒数で止める。画面は点けたまま立てておく)
        if let sec = Double(value("--auto-record") ?? ""), sec > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                guard let self, !self.isRecording else { return }
                self.startRecording()
                DispatchQueue.main.asyncAfter(deadline: .now() + sec) { [weak self] in
                    if let self, self.isRecording { self.stopRecording() }
                    // 試験の間に端末を冷ますため、終わったらアプリを閉じる(UE の絵と映像の送りが動き続けて熱くなるのを防ぐ)
                    if ProcessInfo.processInfo.arguments.contains("--exit-after-record") {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { exit(0) }
                    }
                }
            }
        }
        guard a.contains("--ue-on") else { return }
        ueLink.update(config: UELinkConfig(host: value("--ue-host") ?? ueLink.config.host,
                                           port: Int(value("--ue-port") ?? "") ?? ueLink.config.port,
                                           url: value("--ue-url") ?? ueLink.config.url))
        ueLink.setEnabled(true)
        crosshair?.isHidden = true
        if a.contains("--ue-latency") { DispatchQueue.main.asyncAfter(deadline: .now() + 15) { self.ueLink.measureLatency { _ in } } }
        if a.contains("--ue-test60") { DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self.ueLink.minuteTest { _ in } } }
    }

    // MARK: - 共有

    @objc private func shareTapped() {
        guard let dir = lastDir, !isRecording else { return }
        shareButton.isEnabled = false
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var error: NSError?
            var dest: URL?
            NSFileCoordinator().coordinate(readingItemAt: dir, options: [.forUploading], error: &error) { zipURL in
                let target = FileManager.default.temporaryDirectory.appendingPathComponent("shoot_\(dir.lastPathComponent).zip")
                try? FileManager.default.removeItem(at: target)
                if (try? FileManager.default.copyItem(at: zipURL, to: target)) != nil { dest = target }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.shareButton.isEnabled = true
                guard let dest else {
                    self.notice = "共有用の zip を作れない: \(error?.localizedDescription ?? "")"
                    return
                }
                let vc = UIActivityViewController(activityItems: [dest], applicationActivities: nil)
                vc.popoverPresentationController?.sourceView = self.shareButton
                self.present(vc, animated: true)
            }
        }
    }

    // MARK: - 追跡・割りこみ

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        lock.lock()
        latestFrame = frame
        let rec = recorder
        lock.unlock()
        rec?.append(frame)
        if !ueLink.enabled { enqueuePreview(frame) }
        ueLink.handle(frame: frame, recording: rec != nil)
        pcStream.handle(frame: frame, recordedFrame: rec.map { max($0.currentFrameCount - 1, 0) })
        frameTick += 1
        if frameTick % 6 == 0 { measureClip(frame) }
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        let (text, _) = Pack.tracking(camera.trackingState)
        lock.lock()
        lastTracking = text
        lock.unlock()
        logEvent("tracking:\(text)")
    }

    func sessionWasInterrupted(_ session: ARSession) { logEvent("session:interrupted") }
    func sessionInterruptionEnded(_ session: ARSession) { logEvent("session:interruption-ended") }

    func session(_ session: ARSession, didFailWithError error: Error) {
        logEvent("session:error:\(error.localizedDescription)")
        DispatchQueue.main.async { self.notice = "ARKit のエラー: \(error.localizedDescription)" }
    }

    /// ARFrame のカメラ映像(YpCbCr)を、色変換なしでそのまま画面の層に渡す。
    private func enqueuePreview(_ frame: ARFrame) {
        let pb = frame.capturedImage
        var fmt: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pb, formatDescriptionOut: &fmt) == noErr, let fmt else { return }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMTime(seconds: frame.timestamp, preferredTimescale: 1_000_000), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pb, formatDescription: fmt, sampleTiming: &timing, sampleBufferOut: &sample) == noErr,
              let sample else { return }
        if let arr = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as? [NSMutableDictionary], let d = arr.first {
            d[kCMSampleAttachmentKey_DisplayImmediately] = true
        }
        if previewLayer.status == .failed { previewLayer.flush() }
        previewLayer.enqueue(sample)
        lock.lock(); previewCount += 1; lock.unlock()
    }

    private func logEvent(_ kind: String) {
        lock.lock()
        events.append(ShootEvent(t: ProcessInfo.processInfo.systemUptime, kind: kind))
        lock.unlock()
    }

    private func currentFrame() -> ARFrame? {
        lock.lock(); defer { lock.unlock() }
        return latestFrame
    }

    // MARK: - 表示の更新

    private func refreshUI() {
        lock.lock()
        let rec = recorder
        let started = recordStartDate
        let tracking = lastTracking
        let clip = clipPercent
        let previewN = previewCount
        lock.unlock()
        let recording = rec != nil
        let done = calibration.corners.count

        if calibration.floor == nil {
            stepLabel.text = " 次: 床。十字を床に向けて「床を記録」 "
            calibButton.setTitle("床を記録", for: .normal)
        } else if done < totalCorners {
            let faceName = faceCount == 1 ? "LED" : "LED の面\(Self.faceNames[done / 4])"
            stepLabel.text = " 次: \(faceName)の\(Self.cornerLabels[done % 4])の角(\(done % 4 + 1)/4)\n 十字をその角に合わせて「隅を記録」 "
            calibButton.setTitle("隅を記録:\(faceCount == 1 ? "" : Self.faceNames[done / 4] + " ")\(Self.cornerLabels[done % 4])", for: .normal)
        } else {
            stepLabel.text = recording ? " ● 録画中 " : " 校正おわり。「● 録画開始」を押す "
            calibButton.setTitle("校正おわり ✓", for: .normal)
        }
        guideView.faces = faceCount
        guideView.done = done
        guideView.floorDone = calibration.floor != nil
        guideView.isHidden = recording || ueLink.enabled
        calibButton.isEnabled = calibration.floor == nil || done < totalCorners
        calibButton.alpha = calibButton.isEnabled ? 1 : 0.5
        resetButton.isEnabled = !recording
        resetButton.alpha = recording ? 0.4 : 1
        formatControl.isEnabled = !recording
        faceControl.isEnabled = !recording
        focusSwitch.isEnabled = !recording
        exposureSwitch.isEnabled = !recording
        isoSlider.isEnabled = exposureLocked && !recording
        if exposureLocked { isoLabel.text = "ISO \(Int(isoValue)) 1/60" } else if let d = captureDevice { isoLabel.text = "自動 ISO \(Int(d.iso))" }
        recordButton.setTitle(recording ? "■ 停止" : "● 録画開始", for: .normal)
        shareButton.isEnabled = !recording && lastDir != nil
        shareButton.alpha = shareButton.isEnabled ? 1 : 0.4

        if let rec, let started {
            let sec = Int(Date().timeIntervalSince(started))
            let pcs = pcStream.statusText
            statusLabel.text = String(format: " %02d:%02d  コマ %d  追跡 %@  白飛び %.1f%% ", sec / 60, sec % 60, rec.currentFrameCount, tracking, clip) + (pcs.isEmpty ? "" : "\n \(pcs) ")
        } else {
            let ue = [ueLink.statusText, pcStream.statusText].filter { !$0.isEmpty }.joined(separator: "\n ")
            statusLabel.text = " \(notice ?? String(format: "追跡 %@  映像 %d コマ  白飛び %.1f%%", tracking, previewN, clip))" + (ue.isEmpty ? " " : "\n \(ue) ")
        }
    }
}
