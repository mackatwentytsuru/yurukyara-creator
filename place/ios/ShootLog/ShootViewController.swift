import ARKit
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
    private var notice: String?   // 保存・失敗のお知らせ(次の録画を始めるまで出す)

    private let stepLabel = UILabel()
    private let statusLabel = UILabel()
    private let calibButton = UIButton(type: .system)
    private let resetButton = UIButton(type: .system)
    private let recordButton = UIButton(type: .system)
    private let shareButton = UIButton(type: .system)
    private let formatControl = UISegmentedControl()
    private let faceControl = UISegmentedControl(items: ["LED 1面", "LED 3面(A・B・C)"])
    private let focusSwitch = UISwitch()
    private let focusLabel = UILabel()
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
        sceneView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(calibTapped)))

        addCrosshair()
        setupLabels()
        setupControls()
        pickFormats()
        refreshUI()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.refreshUI() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIApplication.shared.isIdleTimerDisabled = true
        runSession(reset: true)
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
        for (label, size) in [(stepLabel, CGFloat(17)), (statusLabel, CGFloat(13))] {
            label.numberOfLines = 0
            label.textColor = .white
            label.backgroundColor = UIColor.black.withAlphaComponent(0.55)
            label.font = .systemFont(ofSize: size, weight: size > 14 ? .semibold : .regular)
            label.layer.cornerRadius = 8
            label.clipsToBounds = true
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
        }
        NSLayoutConstraint.activate([
            stepLabel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            stepLabel.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            stepLabel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.6),
            statusLabel.leadingAnchor.constraint(equalTo: stepLabel.leadingAnchor),
            statusLabel.topAnchor.constraint(equalTo: stepLabel.bottomAnchor, constant: 6),
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

        let bar = UIStackView(arrangedSubviews: [calibButton, resetButton, recordButton, shareButton])
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
        let side = UIStackView(arrangedSubviews: [faceControl, formatControl, focusRow])
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
        frameQueue.async { [weak self] in
            rec.finish { stats in
                guard let self else { return }
                self.lock.lock()
                let evs = self.events
                self.lock.unlock()
                let iso = ISO8601DateFormatter().string(from: started ?? Date())
                let meta = ShootMeta(
                    startedAt: iso, device: Pack.deviceModel(), systemVersion: UIDevice.current.systemVersion,
                    chosenFormat: fmt, supportedFormats: supported, autoFocus: af,
                    calibration: cal, events: evs, stats: stats, conventions: ShootMeta.conventionText
                )
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
        lock.unlock()
        let recording = rec != nil
        let done = calibration.corners.count

        if calibration.floor == nil {
            stepLabel.text = " ① 床に十字を向けて「床を記録」 "
            calibButton.setTitle("床を記録", for: .normal)
        } else if done < totalCorners {
            let faceName = faceCount == 1 ? "LED" : "LED の面\(Self.faceNames[done / 4])"
            stepLabel.text = " ② 十字を\(faceName)の「\(Self.cornerLabels[done % 4])」に合わせて「隅を記録」(\(done)/\(totalCorners)) "
            calibButton.setTitle("隅を記録:\(faceCount == 1 ? "" : Self.faceNames[done / 4] + " ")\(Self.cornerLabels[done % 4])", for: .normal)
        } else {
            stepLabel.text = recording ? " ● 録画中 " : " ③ 校正おわり。「録画開始」 "
            calibButton.setTitle("校正おわり ✓", for: .normal)
        }
        calibButton.isEnabled = calibration.floor == nil || done < totalCorners
        calibButton.alpha = calibButton.isEnabled ? 1 : 0.5
        resetButton.isEnabled = !recording
        resetButton.alpha = recording ? 0.4 : 1
        formatControl.isEnabled = !recording
        faceControl.isEnabled = !recording
        focusSwitch.isEnabled = !recording
        recordButton.setTitle(recording ? "■ 停止" : "● 録画開始", for: .normal)
        shareButton.isEnabled = !recording && lastDir != nil
        shareButton.alpha = shareButton.isEnabled ? 1 : 0.4

        if let rec, let started {
            let sec = Int(Date().timeIntervalSince(started))
            statusLabel.text = String(format: " %02d:%02d  コマ %d  追跡 %@ ", sec / 60, sec % 60, rec.currentFrameCount, tracking)
        } else {
            statusLabel.text = " \(notice ?? "追跡 \(tracking)") "
        }
    }
}
