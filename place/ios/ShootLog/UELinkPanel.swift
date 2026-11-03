import UIKit

/// 「UE モニター」の設定と測定の画面(撮影記録の下のボタン「UE」から開く)。
final class UELinkPanelViewController: UIViewController, UITextFieldDelegate {
    private let link: UELinkController
    private let pc: PCStreamer
    private let audio: AudioCapture
    private let ar: ARMonitor
    private let arSwitch = UISwitch()
    private let arURLField = UITextField()
    private let setMic: (Bool, @escaping (String?) -> Void) -> Void
    private let micSwitch = UISwitch()
    private let pcSwitch = UISwitch()
    private let pcPortField = UITextField()
    private let onChange: () -> Void
    private let enableSwitch = UISwitch()
    private let hostField = UITextField()
    private let portField = UITextField()
    private let urlField = UITextField()
    private let logView = UITextView()
    private var timer: Timer?

    init(link: UELinkController, pc: PCStreamer, audio: AudioCapture, ar: ARMonitor, setMic: @escaping (Bool, @escaping (String?) -> Void) -> Void, onChange: @escaping () -> Void) {
        self.link = link
        self.pc = pc
        self.audio = audio
        self.ar = ar
        self.setMic = setMic
        self.onChange = onChange
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
    }

    required init?(coder: NSCoder) { fatalError() }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscapeRight }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0.12, alpha: 1)

        func label(_ text: String) -> UILabel {
            let l = UILabel()
            l.text = text
            l.textColor = .white
            l.font = .systemFont(ofSize: 14)
            return l
        }
        func style(_ f: UITextField, _ placeholder: String, _ text: String) {
            f.placeholder = placeholder
            f.text = text
            f.textColor = .white
            f.backgroundColor = UIColor(white: 0.22, alpha: 1)
            f.borderStyle = .roundedRect
            f.autocapitalizationType = .none
            f.autocorrectionType = .no
            f.keyboardType = .URL
            f.returnKeyType = .done
            f.delegate = self
            f.heightAnchor.constraint(equalToConstant: 38).isActive = true
        }
        let c = link.config
        style(hostField, "送り先(作業用 PC の IP、例 192.168.x.x)", c.host)
        style(portField, "ポート", String(c.port))
        portField.keyboardType = .numberPad
        style(pcPortField, "映像ポート", String(pc.port))
        pcPortField.keyboardType = .numberPad
        style(urlField, "絵の URL(例 http://192.168.x.x/?AutoConnect=true&AutoPlayVideo=true&StartVideoMuted=true)", c.url)

        enableSwitch.isOn = link.enabled
        enableSwitch.addTarget(self, action: #selector(switchChanged), for: .valueChanged)
        let switchRow = UIStackView(arrangedSubviews: [label("UE モニター(位置を送り、UE の絵を全画面で見る)"), enableSwitch])
        switchRow.spacing = 10

        func button(_ title: String, _ color: UIColor, _ action: Selector) -> UIButton {
            let b = UIButton(type: .system)
            b.setTitle(title, for: .normal)
            b.setTitleColor(.white, for: .normal)
            b.backgroundColor = color
            b.layer.cornerRadius = 8
            b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
            b.heightAnchor.constraint(equalToConstant: 40).isActive = true
            b.addTarget(self, action: action, for: .touchUpInside)
            return b
        }
        let latency = button("遅れを測る(10 秒、振る)", .systemBlue, #selector(measureLatency))
        let minute = button("1 分テスト", .systemOrange, #selector(minuteTest))
        let reload = button("絵を読み直す", .systemGray, #selector(reloadPicture))
        let close = button("閉じる", .systemGray2, #selector(closeTapped))
        let buttons = UIStackView(arrangedSubviews: [latency, minute, reload, close])
        buttons.spacing = 8
        buttons.distribution = .fillEqually

        logView.isEditable = false
        logView.backgroundColor = UIColor(white: 0.08, alpha: 1)
        logView.textColor = UIColor(white: 0.9, alpha: 1)
        logView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        logView.layer.cornerRadius = 8

        pcSwitch.isOn = pc.enabled
        pcSwitch.addTarget(self, action: #selector(pcSwitchChanged), for: .valueChanged)
        let pcRow = UIStackView(arrangedSubviews: [label("作業用 PC へ映像(確認用。縮小した映像を TCP で送る。録画の元は端末に残る)"), pcPortField, pcSwitch])
        pcRow.spacing = 10
        pcPortField.widthAnchor.constraint(equalToConstant: 90).isActive = true

        micSwitch.isOn = audio.running
        micSwitch.addTarget(self, action: #selector(micSwitchChanged), for: .valueChanged)
        let micRow = UIStackView(arrangedSubviews: [label("マイク(音を録画と作業用 PC へ送りに入れる。自動の音量調整は切る)"), micSwitch])
        micRow.spacing = 10

        style(arURLField, "AR モニターのページの URL", ar.url)
        arSwitch.isOn = ar.enabled
        arSwitch.addTarget(self, action: #selector(arSwitchChanged), for: .valueChanged)
        let arRow = UIStackView(arrangedSubviews: [label("AR モニター(カメラの映像の上にキャラを重ねる)"), arSwitch])
        arRow.spacing = 10

        let hostRow = UIStackView(arrangedSubviews: [hostField, portField])
        hostRow.spacing = 8
        portField.widthAnchor.constraint(equalToConstant: 90).isActive = true

        let stack = UIStackView(arrangedSubviews: [switchRow, hostRow, urlField, pcRow, micRow, arRow, arURLField, buttons, logView])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
        ])
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.refresh() }
        refresh()
    }

    private func refresh() {
        let status = link.statusText
        let pcs = pc.statusText
        logView.text = (status.isEmpty ? "(モニターは切れている)\n" : status + "\n") + (pcs.isEmpty ? "" : pcs + "\n") + link.logText
    }

    private func saveFields() {
        link.update(config: UELinkConfig(host: hostField.text?.trimmingCharacters(in: .whitespaces) ?? "",
                                         port: Int(portField.text ?? "") ?? 9000,
                                         url: urlField.text?.trimmingCharacters(in: .whitespaces) ?? ""))
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        saveFields()
        return true
    }

    @objc private func arSwitchChanged() {
        ar.setEnabled(arSwitch.isOn, url: arURLField.text?.trimmingCharacters(in: .whitespaces))
        onChange()
    }

    @objc private func micSwitchChanged() {
        setMic(micSwitch.isOn) { [weak self] err in
            DispatchQueue.main.async { if err != nil { self?.micSwitch.isOn = false } }
        }
        onChange()
    }

    @objc private func pcSwitchChanged() {
        saveFields()
        pc.setEnabled(pcSwitch.isOn, host: link.config.host, port: Int(pcPortField.text ?? "") ?? 9100)
        onChange()
    }

    @objc private func switchChanged() {
        saveFields()
        link.setEnabled(enableSwitch.isOn)
        onChange()
    }

    @objc private func measureLatency() {
        saveFields()
        view.endEditing(true)
        link.measureLatency { [weak self] _ in self?.refresh() }
    }

    @objc private func minuteTest() {
        saveFields()
        view.endEditing(true)
        link.minuteTest { [weak self] _ in self?.refresh() }
    }

    @objc private func reloadPicture() {
        saveFields()
        link.reloadPicture()
    }

    @objc private func closeTapped() {
        saveFields()
        timer?.invalidate()
        dismiss(animated: true)
        onChange()
    }
}
