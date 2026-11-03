import UIKit

/// 撮影の画面(本番の UI)。録画・送り・校正の中身には触らず、読むだけの ShootStatus を見て、操作は ShootActions を呼ぶ。
/// 映像は上下の帯の間に置き、ボタンは映像に重ねない。親指で押すボタンは下の帯の左右の端。録画のボタンは録画中も同じ位置で、止めるのは長押し。

enum ShootStep: Int, CaseIterable {
    case prepare, calibrate, cut, shoot, takes
    var title: String { ["準備", "校正", "カット", "撮影", "テイク"][rawValue] }
}

enum Lamp {
    case green, yellow, red, off
    var color: UIColor {
        switch self {
        case .green: return UIColor(red: 0.25, green: 0.72, blue: 0.42, alpha: 1)
        case .yellow: return UIColor(red: 0.90, green: 0.72, blue: 0.20, alpha: 1)
        case .red: return UIColor(red: 0.92, green: 0.26, blue: 0.24, alpha: 1)
        case .off: return UIColor(white: 0.35, alpha: 1)
        }
    }
}

struct LampInfo {
    var name: String
    var lamp: Lamp
    var text: String
}

enum RecPhase { case idle, connecting, recording, stopping }

struct CalibInfo {
    var n = 0, total = 33, syncs = 0
    var rms: Double?
    var faces: [(String, Double)] = []
    var good = false, held = false
}

struct TakeInfo: Codable {
    var number: Int
    var cut: String
    var seconds: Double
    var sent: Int
    var macFrames: Int
    var lost: Int
    var thermal: String
    var saved: Bool
    var gaps: Int = 0          // 途中で Mac の応答が止まった回数
    var mark: String = ""      // OK / NG
}

struct ShootStatus {
    var step: ShootStep = .prepare
    var lamps: [LampInfo] = []
    var alarm: String?
    var phase: RecPhase = .idle
    var elapsed: Double = 0
    var macFrames = 0, lost = 0
    var sentFps: Double = 0
    var note: String?            // 例「保存済み 3603 コマ」
    var calib = CalibInfo()
    var host = "", probe = "", permissions = "", battery = "", thermal = "", ipadFree = "", macFree = ""
    var port = 9100
    var micOn = false
    var cutName = "カット1"
    var takeNumber = 1
    var exposureLocked = false
    var isoText = ""
    var isoFraction: Float = 0
    var arOn = false, arHidden = false, arShowing = false
    var arText = ""
    var guides = true
    var takes: [TakeInfo] = []
}

struct ShootActions {
    var setStep: (ShootStep) -> Void = { _ in }
    var record: () -> Void = {}
    var stop: () -> Void = {}
    var arStart: () -> Void = {}
    var arHide: () -> Void = {}
    var calibReset: () -> Void = {}
    var probe: () -> Void = {}
    var setHost: (String) -> Void = { _ in }
    var setMic: (Bool) -> Void = { _ in }
    var setExposure: (Bool) -> Void = { _ in }
    var setISO: (Float) -> Void = { _ in }
    var setCutName: (String) -> Void = { _ in }
    var setGuides: (Bool) -> Void = { _ in }
    var nextCut: () -> Void = {}
    var markTake: (Int, String) -> Void = { _, _ in }
    var details: () -> Void = {}
}

/// 押す物。hold が 0 ならすぐ、0 より大きければ長押しで働く(進む輪を描く。途中で離すと取り消し)。
final class HUDButton: UIControl {
    let id: String
    var onFire: () -> Void = {}
    var hold: Double = 0 { didSet { if hold == 0 { ring.strokeEnd = 0 } } }
    private let label = UILabel()
    private let ring = CAShapeLayer()
    private var startedAt: CFTimeInterval = 0
    private var link: CADisplayLink?
    var round = false { didSet { setNeedsLayout() } }
    var fill = UIColor(white: 0.20, alpha: 1) { didSet { backgroundColor = fill } }

    init(id: String, title: String = "") {
        self.id = id
        super.init(frame: .zero)
        backgroundColor = fill
        layer.cornerRadius = 14
        label.text = title
        label.textColor = UIColor(white: 0.90, alpha: 1)
        label.font = .systemFont(ofSize: 20, weight: .bold)
        label.textAlignment = .center
        label.numberOfLines = 2
        label.adjustsFontSizeToFitWidth = true
        label.minimumScaleFactor = 0.6
        addSubview(label)
        ring.fillColor = UIColor.clear.cgColor
        ring.strokeColor = UIColor.white.cgColor
        ring.lineWidth = 7
        ring.strokeEnd = 0
        layer.addSublayer(ring)
    }

    required init?(coder: NSCoder) { fatalError() }

    func setTitle(_ t: String) { if label.text != t { label.text = t } }

    override func layoutSubviews() {
        super.layoutSubviews()
        label.frame = bounds.insetBy(dx: 6, dy: 4)
        layer.cornerRadius = round ? bounds.width / 2 : 14
        let inset: CGFloat = 4
        ring.frame = bounds
        ring.path = (round ? UIBezierPath(ovalIn: bounds.insetBy(dx: inset, dy: inset)) : UIBezierPath(roundedRect: bounds.insetBy(dx: inset, dy: inset), cornerRadius: 12)).cgPath
    }

    override var isEnabled: Bool { didSet { alpha = isEnabled ? 1 : 0.35 } }

    override func beginTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
        alpha = 0.7
        if hold > 0 {
            startedAt = CACurrentMediaTime()
            link = CADisplayLink(target: self, selector: #selector(tick))
            link?.add(to: .main, forMode: .common)
        }
        return true
    }

    @objc private func tick() {
        let k = (CACurrentMediaTime() - startedAt) / hold
        CATransaction.begin(); CATransaction.setDisableActions(true); ring.strokeEnd = min(1, k); CATransaction.commit()
        if k >= 1 { cancelHold(); onFire() }
    }

    private func cancelHold() {
        link?.invalidate(); link = nil
        CATransaction.begin(); CATransaction.setDisableActions(true); ring.strokeEnd = 0; CATransaction.commit()
    }

    override func endTracking(_ touch: UITouch?, with event: UIEvent?) {
        alpha = isEnabled ? 1 : 0.35
        if hold > 0 { cancelHold(); return }
        if let touch, bounds.insetBy(dx: -20, dy: -20).contains(touch.location(in: self)) { onFire() }
    }

    override func cancelTracking(with event: UIEvent?) {
        alpha = isEnabled ? 1 : 0.35
        cancelHold()
    }
}

/// 映像に重ねる枠の線(セーフエリア 90%・80%、中心の十字)。タッチは受けない。
final class FrameGuideView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {
        guard let c = UIGraphicsGetCurrentContext() else { return }
        c.setStrokeColor(UIColor(white: 1, alpha: 0.28).cgColor)
        c.setLineWidth(1)
        for k in [0.9, 0.8] as [CGFloat] {
            let w = bounds.width * k, h = bounds.height * k
            c.stroke(CGRect(x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, width: w, height: h))
        }
        let cx = bounds.midX, cy = bounds.midY
        c.move(to: CGPoint(x: cx - 18, y: cy)); c.addLine(to: CGPoint(x: cx + 18, y: cy))
        c.move(to: CGPoint(x: cx, y: cy - 18)); c.addLine(to: CGPoint(x: cx, y: cy + 18))
        c.strokePath()
    }
}

final class ShootHUD: UIView, UITextFieldDelegate {
    var actions = ShootActions()

    private let topBar = UIView()
    private let bottomBar = UIView()
    private var stepButtons: [HUDButton] = []
    private var lampDots: [UIView] = []
    private var lampLabels: [UILabel] = []
    private let gear = HUDButton(id: "details", title: "詳細")
    private let alarmLabel = UILabel()
    private let leftButton = HUDButton(id: "left")
    private let left2Button = HUDButton(id: "left2")
    private let rightButton = HUDButton(id: "right")
    private let bigLabel = UILabel()
    private let smallLabel = UILabel()
    private let guide = FrameGuideView()
    private let recBorder = UIView()
    // ①準備
    private let prepPanel = UIView()
    private let hostField = UITextField()
    private let prepText = UILabel()
    private let micSwitch = UISwitch()
    private let micLabel = UILabel()
    private let guideLabel = UILabel()
    // ③カット
    private let cutPanel = UIView()
    private let cutField = UITextField()
    private let lensControl = UISegmentedControl(items: ["広角(AR・位置あり)", "超広角(次の版)"])
    private let exposureSwitch = UISwitch()
    private let isoSlider = UISlider()
    private let isoLabel = UILabel()
    private let guideSwitch = UISwitch()
    // ⑤テイク
    private let takesPanel = UIView()
    private let takesLabel = UILabel()
    private var markButtons: [HUDButton] = []
    private var markRows: [UILabel] = []

    private(set) var status = ShootStatus()
    private var picture = CGRect.zero

    private static let primary = UIColor(white: 0.86, alpha: 1)
    private static let secondary = UIColor(white: 0.62, alpha: 1)
    private static let panelColor = UIColor(white: 0.05, alpha: 0.92)
    private static let accent = UIColor(red: 0.16, green: 0.34, blue: 0.56, alpha: 1)
    private static let recRed = UIColor(red: 0.72, green: 0.13, blue: 0.13, alpha: 1)

    /// 上下の帯の高さ。iPhone のように背が低い画面では詰める。
    static func bars(_ bounds: CGRect) -> (top: CGFloat, bottom: CGFloat) {
        bounds.height >= 700 ? (52, 110) : (40, 78)
    }

    /// 映像を置く枠(映像の全部が入る)
    static func pictureRect(in bounds: CGRect, image: CGSize) -> CGRect {
        let b = bars(bounds)
        let area = CGRect(x: 0, y: b.top, width: bounds.width, height: bounds.height - b.top - b.bottom)
        let k = min(area.width / image.width, area.height / image.height)
        let w = image.width * k, h = image.height * k
        return CGRect(x: (bounds.width - w) / 2, y: area.minY + (area.height - h) / 2, width: w, height: h)
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        build()
    }

    required init?(coder: NSCoder) { fatalError() }

    /// 下のものに触れるように、自分のボタンの上でなければ素通しする
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let v = super.hitTest(point, with: event)
        return v === self ? nil : v
    }

    private func label(_ size: CGFloat, _ color: UIColor = ShootHUD.primary, weight: UIFont.Weight = .regular) -> UILabel {
        let l = UILabel()
        l.font = .systemFont(ofSize: size, weight: weight)
        l.textColor = color
        return l
    }

    private func build() {
        for v in [topBar, bottomBar] { v.backgroundColor = .black; addSubview(v) }
        for s in ShootStep.allCases {
            let b = HUDButton(id: "step\(s.rawValue)", title: "\(s.rawValue + 1) \(s.title)")
            b.onFire = { [weak self] in self?.actions.setStep(s) }
            stepButtons.append(b)
            topBar.addSubview(b)
        }
        for _ in 0..<5 {
            let d = UIView(); d.layer.cornerRadius = 7
            let l = label(16, weight: .semibold)
            l.adjustsFontSizeToFitWidth = true
            l.minimumScaleFactor = 0.7
            lampDots.append(d); lampLabels.append(l)
            topBar.addSubview(d); topBar.addSubview(l)
        }
        gear.onFire = { [weak self] in self?.actions.details() }
        topBar.addSubview(gear)
        alarmLabel.font = .systemFont(ofSize: 24, weight: .heavy)
        alarmLabel.textColor = .white
        alarmLabel.backgroundColor = Lamp.red.color.withAlphaComponent(0.85)
        alarmLabel.textAlignment = .center
        alarmLabel.adjustsFontSizeToFitWidth = true
        alarmLabel.minimumScaleFactor = 0.6
        alarmLabel.isHidden = true
        topBar.addSubview(alarmLabel)

        addSubview(guide)
        recBorder.isUserInteractionEnabled = false
        recBorder.layer.borderColor = ShootHUD.recRed.cgColor
        recBorder.layer.borderWidth = 3
        recBorder.isHidden = true
        addSubview(recBorder)

        bigLabel.font = .monospacedDigitSystemFont(ofSize: 34, weight: .bold)
        bigLabel.textColor = ShootHUD.primary
        bigLabel.textAlignment = .center
        bigLabel.adjustsFontSizeToFitWidth = true
        bigLabel.minimumScaleFactor = 0.6
        smallLabel.font = .systemFont(ofSize: 18, weight: .medium)
        smallLabel.textColor = ShootHUD.secondary
        smallLabel.textAlignment = .center
        smallLabel.numberOfLines = 2
        smallLabel.adjustsFontSizeToFitWidth = true
        smallLabel.minimumScaleFactor = 0.7
        bottomBar.addSubview(bigLabel)
        bottomBar.addSubview(smallLabel)
        for b in [leftButton, left2Button, rightButton] { bottomBar.addSubview(b) }

        buildPrep()
        buildCut()
        buildTakes()
    }

    private func panel(_ v: UIView) {
        v.backgroundColor = ShootHUD.panelColor
        v.layer.cornerRadius = 14
        v.isHidden = true
        addSubview(v)
    }

    private func styleField(_ f: UITextField, placeholder: String) {
        f.font = .systemFont(ofSize: 26, weight: .semibold)
        f.textColor = ShootHUD.primary
        f.backgroundColor = UIColor(white: 0.14, alpha: 1)
        f.layer.cornerRadius = 10
        f.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: ShootHUD.secondary])
        f.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 10))
        f.leftViewMode = .always
        f.delegate = self
        f.autocorrectionType = .no
        f.autocapitalizationType = .none
        f.returnKeyType = .done
    }

    private func buildPrep() {
        panel(prepPanel)
        styleField(hostField, placeholder: "Mac の IP(Mac の窓に出る数字)")
        hostField.keyboardType = .numbersAndPunctuation
        hostField.addTarget(self, action: #selector(hostEdited), for: .editingChanged)
        prepText.numberOfLines = 0
        prepText.font = .systemFont(ofSize: 24)
        prepText.textColor = ShootHUD.primary
        micSwitch.addTarget(self, action: #selector(micChanged), for: .valueChanged)
        prepPanel.addSubview(hostField)
        prepPanel.addSubview(prepText)
        prepPanel.addSubview(micSwitch)
        micLabel.text = "マイク"
        micLabel.font = .systemFont(ofSize: 22, weight: .semibold)
        micLabel.textColor = ShootHUD.primary
        micLabel.textAlignment = .right
        prepPanel.addSubview(micLabel)
    }

    private func buildCut() {
        panel(cutPanel)
        styleField(cutField, placeholder: "カットの名前")
        cutField.addTarget(self, action: #selector(cutEdited), for: .editingChanged)
        lensControl.selectedSegmentIndex = 0
        lensControl.setEnabled(false, forSegmentAt: 1)
        lensControl.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 18, weight: .semibold)], for: .normal)
        lensControl.selectedSegmentTintColor = ShootHUD.accent
        lensControl.setTitleTextAttributes([.foregroundColor: ShootHUD.primary], for: .selected)
        lensControl.setTitleTextAttributes([.foregroundColor: ShootHUD.secondary, .font: UIFont.systemFont(ofSize: 18, weight: .semibold)], for: .normal)
        exposureSwitch.addTarget(self, action: #selector(exposureChanged), for: .valueChanged)
        isoSlider.addTarget(self, action: #selector(isoChanged), for: .valueChanged)
        guideSwitch.addTarget(self, action: #selector(guideChanged), for: .valueChanged)
        isoLabel.font = .systemFont(ofSize: 20)
        isoLabel.textColor = ShootHUD.primary
        guideLabel.text = "枠線(セーフエリア)"
        guideLabel.font = .systemFont(ofSize: 20)
        guideLabel.textColor = ShootHUD.primary
        for v in [cutField, lensControl, exposureSwitch, isoSlider, isoLabel, guideSwitch, guideLabel] as [UIView] { cutPanel.addSubview(v) }
    }

    private func buildTakes() {
        panel(takesPanel)
        takesLabel.font = .systemFont(ofSize: 22, weight: .bold)
        takesLabel.textColor = ShootHUD.primary
        takesPanel.addSubview(takesLabel)
        for i in 0..<6 {
            let l = label(19)
            l.font = .monospacedDigitSystemFont(ofSize: 19, weight: .regular)
            l.adjustsFontSizeToFitWidth = true
            l.minimumScaleFactor = 0.7
            markRows.append(l)
            takesPanel.addSubview(l)
            for (j, m) in ["OK", "NG"].enumerated() {
                let b = HUDButton(id: "mark\(i)_\(m)", title: m)
                b.onFire = { [weak self] in
                    guard let self else { return }
                    let list = Array(self.status.takes.suffix(6).reversed())
                    if i < list.count { self.actions.markTake(list[i].number, m) }
                }
                b.tag = i * 2 + j
                markButtons.append(b)
                takesPanel.addSubview(b)
            }
        }
    }

    @objc private func hostEdited() { actions.setHost(hostField.text ?? "") }
    @objc private func cutEdited() { actions.setCutName(cutField.text ?? "") }
    @objc private func micChanged() { actions.setMic(micSwitch.isOn) }
    @objc private func exposureChanged() { actions.setExposure(exposureSwitch.isOn) }
    @objc private func isoChanged() { actions.setISO(isoSlider.value) }
    @objc private func guideChanged() { actions.setGuides(guideSwitch.isOn) }
    func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }

    override func layoutSubviews() {
        super.layoutSubviews()
        let b = ShootHUD.bars(bounds)
        topBar.frame = CGRect(x: 0, y: 0, width: bounds.width, height: b.top)
        bottomBar.frame = CGRect(x: 0, y: bounds.height - b.bottom, width: bounds.width, height: b.bottom)
        let stepW: CGFloat = min(84, bounds.width * 0.07), stepH = b.top - 8
        for (i, s) in stepButtons.enumerated() { s.frame = CGRect(x: 8 + CGFloat(i) * (stepW + 4), y: 4, width: stepW, height: stepH) }
        let gearW: CGFloat = 64
        gear.frame = CGRect(x: bounds.width - gearW - 8, y: 4, width: gearW, height: stepH)
        let lampsX = 8 + 5 * (stepW + 4) + 10
        let lampW = (gear.frame.minX - 8 - lampsX) / 5
        for i in 0..<5 {
            let x = lampsX + CGFloat(i) * lampW
            lampDots[i].frame = CGRect(x: x, y: (b.top - 14) / 2, width: 14, height: 14)
            lampLabels[i].frame = CGRect(x: x + 19, y: 2, width: lampW - 22, height: b.top - 4)
        }
        alarmLabel.frame = CGRect(x: 8, y: 2, width: lampsX - 16, height: b.top - 4)

        let side: CGFloat = bounds.height >= 700 ? 88 : 64
        let rec: CGFloat = bounds.height >= 700 ? 92 : 68
        leftButton.frame = CGRect(x: 16, y: (b.bottom - side) / 2, width: side + 44, height: side)
        left2Button.frame = CGRect(x: leftButton.frame.maxX + 24, y: (b.bottom - side) / 2, width: side + 12, height: side)
        rightButton.frame = CGRect(x: bounds.width - 16 - rec - (rightButton.round ? 0 : 44), y: (b.bottom - rec) / 2, width: rec + (rightButton.round ? 0 : 44), height: rec)
        let cx0 = left2Button.frame.maxX + 16, cx1 = bounds.width - 16 - rec - 44 - 16
        bigLabel.frame = CGRect(x: cx0, y: 6, width: cx1 - cx0, height: b.bottom * 0.5)
        smallLabel.frame = CGRect(x: cx0, y: b.bottom * 0.52, width: cx1 - cx0, height: b.bottom * 0.44)

        picture = ShootHUD.pictureRect(in: bounds, image: CGSize(width: 16, height: 9))
        guide.frame = picture
        guide.setNeedsDisplay()
        recBorder.frame = picture.insetBy(dx: -2, dy: -2)
        let pan = picture.insetBy(dx: 60, dy: 40)
        for p in [prepPanel, cutPanel, takesPanel] { p.frame = pan }
        // ①
        hostField.frame = CGRect(x: 24, y: 24, width: pan.width - 48, height: 58)
        micSwitch.frame.origin = CGPoint(x: pan.width - 24 - micSwitch.bounds.width, y: 102)
        micLabel.frame = CGRect(x: micSwitch.frame.minX - 110, y: 98, width: 100, height: 40)
        let textW = pan.width - 48
        let textH = prepText.sizeThatFits(CGSize(width: textW, height: 400)).height
        prepText.frame = CGRect(x: 24, y: 146, width: textW, height: min(textH, pan.height - 160))
        // ③
        cutField.frame = CGRect(x: 24, y: 24, width: pan.width - 48, height: 58)
        lensControl.frame = CGRect(x: 24, y: 100, width: pan.width - 48, height: 64)
        isoLabel.frame = CGRect(x: 24, y: 186, width: pan.width - 150, height: 40)
        exposureSwitch.frame.origin = CGPoint(x: pan.width - 24 - exposureSwitch.bounds.width, y: 190)
        isoSlider.frame = CGRect(x: 24, y: 240, width: pan.width - 48, height: 48)
        guideSwitch.frame.origin = CGPoint(x: pan.width - 24 - guideSwitch.bounds.width, y: 310)
        guideLabel.frame = CGRect(x: 24, y: 306, width: pan.width - 150, height: 40)
        // ⑤
        takesLabel.frame = CGRect(x: 24, y: 14, width: pan.width - 48, height: 36)
        let rowH: CGFloat = 70
        for i in 0..<markRows.count {
            let y = 58 + CGFloat(i) * rowH
            markRows[i].frame = CGRect(x: 24, y: y, width: pan.width - 24 - 180, height: 60)
            markButtons[i * 2].frame = CGRect(x: pan.width - 172, y: y, width: 72, height: 60)
            markButtons[i * 2 + 1].frame = CGRect(x: pan.width - 88, y: y, width: 72, height: 60)
        }
    }

    // MARK: - 状態を画面へ

    func apply(_ s: ShootStatus) {
        status = s
        let recording = s.phase == .recording || s.phase == .connecting || s.phase == .stopping
        for (i, b) in stepButtons.enumerated() {
            b.fill = i == s.step.rawValue ? ShootHUD.accent : UIColor(white: 0.14, alpha: 1)
            b.isEnabled = !recording || i == s.step.rawValue
        }
        gear.isEnabled = !recording
        for i in 0..<5 {
            if i < s.lamps.count {
                lampDots[i].backgroundColor = s.lamps[i].lamp.color
                lampLabels[i].text = s.lamps[i].name + " " + s.lamps[i].text
                lampLabels[i].textColor = s.lamps[i].lamp == .red ? Lamp.red.color : ShootHUD.primary
            }
        }
        alarmLabel.text = s.alarm
        alarmLabel.isHidden = s.alarm == nil
        for b in stepButtons { b.isHidden = s.alarm != nil }
        guide.isHidden = !s.guides || s.step != .shoot
        recBorder.isHidden = s.phase != .recording
        recBorder.layer.borderColor = (s.alarm != nil ? Lamp.red.color : ShootHUD.recRed).cgColor

        prepPanel.isHidden = s.step != .prepare
        cutPanel.isHidden = s.step != .cut
        takesPanel.isHidden = s.step != .takes

        smallLabel.textColor = ShootHUD.secondary
        leftButton.isHidden = false; left2Button.isHidden = true
        leftButton.hold = 0
        leftButton.isEnabled = true
        rightButton.round = false
        rightButton.hold = 0
        rightButton.isEnabled = true
        rightButton.fill = ShootHUD.accent
        switch s.step {
        case .prepare: applyPrepare(s)
        case .calibrate: applyCalibrate(s)
        case .cut: applyCut(s)
        case .shoot: applyShoot(s)
        case .takes: applyTakes(s)
        }
        setNeedsLayout()
    }

    private func applyPrepare(_ s: ShootStatus) {
        if !hostField.isFirstResponder { hostField.text = s.host }
        micSwitch.isOn = s.micOn
        prepText.text = """
        受け手: \(s.probe)
        許可: \(s.permissions)
        本体: \(s.thermal)・電池 \(s.battery)・空き \(s.ipadFree)
        Mac の空き: \(s.macFree)
        """
        leftButton.setTitle("つなぎの試し"); leftButton.onFire = { [weak self] in self?.actions.probe() }
        rightButton.setTitle("次へ 校正"); rightButton.onFire = { [weak self] in self?.actions.setStep(.calibrate) }
        bigLabel.text = "1 準備"; bigLabel.textColor = ShootHUD.primary
        smallLabel.text = "Mac で「受け手を起動」→ 窓に出る IP を入れて、つなぎの試し"
    }

    private func applyCalibrate(_ s: ShootStatus) {
        let c = s.calib
        let rms = c.rms.map { String(format: "%.1f cm", $0) } ?? "-"
        bigLabel.text = c.good ? "校正 OK  点 \(c.n)/\(c.total)  残差 \(rms)" : (c.held ? "前の校正を保持  点 \(c.n)/\(c.total)" : "校正中  点 \(c.n)/\(c.total)  残差 \(rms)")
        bigLabel.textColor = c.good ? Lamp.green.color : (c.held ? Lamp.yellow.color : ShootHUD.primary)
        let faces = c.faces.map { "\($0.0) \(String(format: "%.1f", $0.1))" }.joined(separator: "  ")
        smallLabel.text = (faces.isEmpty ? "LED に点の映像を流し、8 m より離れて 3 面を入れる" : "面ごとの残差(cm) \(faces)") + "\n合図 \(c.syncs) 回。合格の目安: 点 20 以上・残差 4 cm 以下"
        leftButton.setTitle("やり直し\n(長押し)"); leftButton.hold = 1.2
        leftButton.onFire = { [weak self] in self?.actions.calibReset() }
        rightButton.setTitle("次へ カット"); rightButton.onFire = { [weak self] in self?.actions.setStep(.cut) }
        rightButton.fill = c.good ? ShootHUD.accent : UIColor(white: 0.20, alpha: 1)
    }

    private func applyCut(_ s: ShootStatus) {
        if !cutField.isFirstResponder { cutField.text = s.cutName }
        exposureSwitch.isOn = s.exposureLocked
        isoSlider.isEnabled = s.exposureLocked
        if !isoSlider.isTracking { isoSlider.value = s.isoFraction }
        isoLabel.text = s.exposureLocked ? "露出固定 \(s.isoText) 1/60" : "露出は自動 \(s.isoText)(右のスイッチで固定)"
        guideSwitch.isOn = s.guides
        leftButton.setTitle("校正へ"); leftButton.onFire = { [weak self] in self?.actions.setStep(.calibrate) }
        rightButton.setTitle("次へ 撮影"); rightButton.onFire = { [weak self] in self?.actions.setStep(.shoot) }
        bigLabel.text = "\(s.cutName) テイク \(s.takeNumber)"; bigLabel.textColor = ShootHUD.primary
        smallLabel.text = "広角はキャラの確認と位置の記録あり"
    }

    private func applyShoot(_ s: ShootStatus) {
        leftButton.setTitle("AR 開始"); leftButton.onFire = { [weak self] in self?.actions.arStart() }
        leftButton.isEnabled = s.arOn
        left2Button.isHidden = false
        left2Button.setTitle(s.arHidden ? "AR 出す" : "AR 消す")
        left2Button.onFire = { [weak self] in self?.actions.arHide() }
        rightButton.round = true
        rightButton.onFire = { [weak self] in
            guard let self else { return }
            if self.status.phase == .idle { self.actions.record() } else if self.status.phase == .recording { self.actions.stop() }
        }
        let t = Int(s.elapsed)
        let time = String(format: "%02d:%02d:%02d", t / 3600, t / 60 % 60, t % 60)
        switch s.phase {
        case .idle:
            rightButton.setTitle("録画"); rightButton.fill = ShootHUD.recRed
            bigLabel.text = s.note ?? "\(s.cutName) テイク \(s.takeNumber)"
            bigLabel.textColor = s.note != nil ? Lamp.green.color : ShootHUD.primary
            smallLabel.text = s.arText
        case .connecting:
            rightButton.setTitle("…"); rightButton.fill = UIColor(white: 0.25, alpha: 1); rightButton.isEnabled = false
            bigLabel.text = "Mac につないでいます"; bigLabel.textColor = Lamp.yellow.color
            smallLabel.text = "まだ録画していません"
        case .recording:
            rightButton.setTitle("停止\n長押し"); rightButton.fill = UIColor(white: 0.25, alpha: 1); rightButton.hold = 1.2
            bigLabel.text = "● REC \(time)"; bigLabel.textColor = Lamp.red.color
            smallLabel.text = "Mac 保存 \(s.macFrames) コマ  切れた \(s.lost)  \(String(format: "%.0f", s.sentFps)) fps"
            smallLabel.textColor = s.alarm != nil ? Lamp.red.color : ShootHUD.secondary
        case .stopping:
            rightButton.setTitle("保存中"); rightButton.fill = UIColor(white: 0.25, alpha: 1); rightButton.isEnabled = false
            bigLabel.text = "保存を確かめています"; bigLabel.textColor = Lamp.yellow.color
            smallLabel.text = "Mac 保存 \(s.macFrames) コマ"
        }
    }

    private func applyTakes(_ s: ShootStatus) {
        takesLabel.text = "テイク(新しい順。全 \(s.takes.count) 本)"
        let list = Array(s.takes.suffix(6).reversed())
        for i in 0..<markRows.count {
            let has = i < list.count
            markRows[i].isHidden = !has
            markButtons[i * 2].isHidden = !has
            markButtons[i * 2 + 1].isHidden = !has
            guard has else { continue }
            let t = list[i]
            let sec = Int(t.seconds)
            let warn = t.saved ? "" : " 保存未確認"
            markRows[i].text = String(format: "%2d  %@  %d:%02d  %d コマ  切れた %d  %@%@", t.number, t.cut, sec / 60, sec % 60, t.macFrames, t.lost, t.thermal, warn)
            markRows[i].textColor = t.saved ? ShootHUD.primary : Lamp.red.color
            markButtons[i * 2].fill = t.mark == "OK" ? Lamp.green.color : UIColor(white: 0.2, alpha: 1)
            markButtons[i * 2 + 1].fill = t.mark == "NG" ? Lamp.red.color : UIColor(white: 0.2, alpha: 1)
        }
        leftButton.setTitle("次のカット"); leftButton.onFire = { [weak self] in self?.actions.nextCut() }
        rightButton.setTitle("次のテイク"); rightButton.onFire = { [weak self] in self?.actions.setStep(.shoot) }
        bigLabel.text = "\(s.cutName) 次はテイク \(s.takeNumber)"; bigLabel.textColor = ShootHUD.primary
        smallLabel.text = ""
    }

    // MARK: - 自動の確かめ

    /// 今見えている押す物の枠(ID と、画面の座標)。大きさ・重なり・映像にかからないかの確かめに使う。
    func targets() -> [[String: Any]] {
        var out: [[String: Any]] = []
        func add(_ v: UIView, _ id: String) {
            guard !v.isHidden, v.alpha > 0.01, v.window != nil || v.superview != nil else { return }
            var p = v.superview
            while let q = p, q !== self { if q.isHidden { return }; p = q.superview }
            let f = v.convert(v.bounds, to: self)
            out.append(["id": id, "x": f.minX, "y": f.minY, "w": f.width, "h": f.height, "enabled": (v as? UIControl)?.isEnabled ?? true])
        }
        for b in stepButtons + [gear, leftButton, left2Button, rightButton] + markButtons { add(b, b.id) }
        add(hostField, "hostField"); add(micSwitch, "micSwitch"); add(cutField, "cutField"); add(lensControl, "lensControl")
        add(exposureSwitch, "exposureSwitch"); add(isoSlider, "isoSlider"); add(guideSwitch, "guideSwitch")
        return out
    }

    var pictureFrame: CGRect { picture }

    /// 試験: ID で押す(本物の経路)
    func fire(_ id: String) -> Bool {
        for b in stepButtons + [gear, leftButton, left2Button, rightButton] + markButtons where b.id == id && !b.isHidden && b.isEnabled {
            b.onFire()
            return true
        }
        return false
    }
}
