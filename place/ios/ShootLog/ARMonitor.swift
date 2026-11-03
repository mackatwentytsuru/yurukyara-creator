import ARKit
import Foundation
import UIKit
import WebKit

/// 「AR モニター」: 撮影中に、カメラの映像の上にキャラ(見本のキャラ)を、ショーの動きと時刻に合わせて重ねて見る(低画質の確認用)。
/// 透明な WKWebView に three.js のページ(place/web/ar_show.html)を重ね、毎コマ ARKit の姿勢を送る(ARStage と同じ約束)。
/// ショーの時刻は、LED の映像の頭の「合図のフラッシュ」を、映像の明るさの急な立ち上がりとして検出して、ARFrame の時刻でページへ知らせる(手で「いま開始」でもよい)。
/// LED の 4 隅の校正(撮影記録の校正)ができていれば、ページが面 A の位置を解く。録画と同じ ARSession を使うので、録画しながら動かせる。
struct ARMonitorSummary: Codable {
    var enabled: Bool
    var url: String
    var posesSent: Int
    var posesSkipped: Int
    var flashes: Int
    var thermalAtStart: String
    var thermalMax: String
    var pageMessages: [String]
    var pageStatus: String? = nil   // ページが 1〜2 秒おきに知らせる最後の状態(キャラが出ているか・ショーの時刻・校正の残差)
}

final class ARMonitor: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    private let lock = NSLock()
    private(set) var enabled = false
    private var pageReady = false
    private var inFlight = false
    private var viewSize = CGSize(width: 844, height: 390)
    private var posesSent = 0, posesSkipped = 0, flashes = 0
    private var baseline = -1.0
    private var wasAbove = false
    private var lastFlashTs = -100.0
    private var lastCalibrationJSON: String?
    private var lastFloor: Float?
    private var thermalAtStart = ""
    private var thermalMaxRank = 0
    private var messages: [String] = []
    private var pageStatus: String?
    var flashThreshold = 25.0
    private static let urlKey = "armonitor.url"
    static let defaultURL = "https://192.168.x.x:8443/place/web/ar_show.html"

    var url: String {
        get { UserDefaults.standard.string(forKey: Self.urlKey) ?? Self.defaultURL }
        set { UserDefaults.standard.set(newValue, forKey: Self.urlKey) }
    }

    override init() {
        let conf = WKWebViewConfiguration()
        conf.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: conf)
        super.init()
        conf.userContentController.add(self, name: "arhost")
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.isUserInteractionEnabled = false
        webView.isHidden = true
        NotificationCenter.default.addObserver(self, selector: #selector(thermalChanged), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
    }

    @objc private func thermalChanged() {
        lock.lock(); thermalMaxRank = max(thermalMaxRank, UELinkController.thermalRank(ProcessInfo.processInfo.thermalState)); lock.unlock()
    }

    func layoutChanged(_ size: CGSize) {
        lock.lock(); viewSize = size; lock.unlock()
    }

    func setEnabled(_ on: Bool, url newURL: String? = nil) {
        if let newURL, !newURL.isEmpty { url = newURL }
        guard on != enabled else { return }
        enabled = on
        if on {
            lock.lock()
            posesSent = 0; posesSkipped = 0; flashes = 0; baseline = -1; wasAbove = false; pageReady = false; messages = []
            thermalAtStart = UELinkController.thermalName(ProcessInfo.processInfo.thermalState)
            thermalMaxRank = UELinkController.thermalRank(ProcessInfo.processInfo.thermalState)
            lock.unlock()
            if let u = URL(string: url), u.scheme != nil { webView.load(URLRequest(url: u)) }
            webView.isHidden = false
        } else {
            webView.isHidden = true
            webView.loadHTMLString("", baseURL: nil)
            lock.lock(); pageReady = false; lock.unlock()
        }
    }

    // MARK: - コマごと(ARSession の delegateQueue から)

    func handle(frame: ARFrame) {
        guard enabled else { return }
        detectFlash(frame)
        lock.lock()
        guard pageReady else { lock.unlock(); return }
        if inFlight { posesSkipped += 1; lock.unlock(); return }
        inFlight = true
        let size = viewSize
        lock.unlock()
        let view = frame.camera.viewMatrix(for: .landscapeRight)
        let world = simd_inverse(view)
        let proj = frame.camera.projectionMatrix(for: .landscapeRight, viewportSize: size, zNear: 0.05, zFar: 80)
        let js = "window.__arhost&&window.__arhost.onPose(\(Self.array(world)),\(Self.array(proj)),\(String(format: "%.6f", frame.timestamp)))"
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(js) { _, _ in
                guard let self else { return }
                self.lock.lock(); self.inFlight = false; self.posesSent += 1; self.lock.unlock()
            }
        }
    }

    /// 映像の明るさ(輝度の平均、32×18 点)が、ふだんより急に上がったとき = LED の合図のフラッシュ。3 秒は次を数えない。
    private func detectFlash(_ frame: ARFrame) {
        let pb = frame.capturedImage
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard CVPixelBufferGetPlaneCount(pb) > 0, let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return }
        let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0), bpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        var sum = 0
        for gy in 0..<18 {
            let y = gy * h / 18 + h / 36
            let row = base + y * bpr
            for gx in 0..<32 { sum += Int(row.load(fromByteOffset: gx * w / 32 + w / 64, as: UInt8.self)) }
        }
        let mean = Double(sum) / 576.0
        if baseline < 0 { baseline = mean }
        let above = mean > baseline + flashThreshold
        if above && !wasAbove && frame.timestamp - lastFlashTs > 3.0 {
            lastFlashTs = frame.timestamp
            lock.lock(); flashes += 1; lock.unlock()
            let ts = frame.timestamp
            DispatchQueue.main.async { [weak self] in
                self?.webView.evaluateJavaScript("window.__arhost&&window.__arhost.onFlash&&window.__arhost.onFlash(\(String(format: "%.6f", ts)))", completionHandler: nil)
            }
        }
        if !above { baseline = baseline * 0.9 + mean * 0.1 }
        wasAbove = above
    }

    // MARK: - 校正をページへ

    func setCalibration(_ cal: Calibration) {
        let arr: [[String: Any]] = cal.corners.map { ["face": $0.face, "id": $0.id, "origin": $0.rayOrigin.map { Double($0) }, "direction": $0.rayDirection.map { Double($0) }] }
        guard let data = try? JSONSerialization.data(withJSONObject: arr), let json = String(data: data, encoding: .utf8) else { return }
        lock.lock(); lastCalibrationJSON = json; let ready = pageReady; lock.unlock()
        if ready { pushCalibration() }
    }

    private func pushCalibration() {
        lock.lock(); let json = lastCalibrationJSON; lock.unlock()
        guard let json else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("window.__arhost&&window.__arhost.onCalibration&&window.__arhost.onCalibration(\(json))", completionHandler: nil)
        }
    }

    private static func array(_ m: simd_float4x4) -> String {
        let c = m.columns
        let v = [c.0, c.1, c.2, c.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
        return "[" + v.map { String(format: "%.5f", $0) }.joined(separator: ",") + "]"
    }

    // MARK: - ページとの会話・自己署名の信用

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "status" {
            if let d = try? JSONSerialization.data(withJSONObject: body), let str = String(data: d, encoding: .utf8) { lock.lock(); pageStatus = str; lock.unlock() }
            return
        }
        lock.lock(); if messages.count < 20 { messages.append(type) }; lock.unlock()
        if type == "ready" {
            lock.lock(); pageReady = true; lock.unlock()
            pushCalibration()
        }
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        if space.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space.serverTrust, space.host == URL(string: url)?.host {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        lock.lock(); messages.append("fail:\(error.localizedDescription)"); lock.unlock()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        lock.lock(); messages.append("fail:\(error.localizedDescription)"); lock.unlock()
    }

    // MARK: - 記録・表示

    func summary() -> ARMonitorSummary {
        lock.lock(); defer { lock.unlock() }
        return ARMonitorSummary(enabled: enabled, url: url, posesSent: posesSent, posesSkipped: posesSkipped, flashes: flashes,
                                thermalAtStart: thermalAtStart, thermalMax: UELinkController.thermalNameFromRank(thermalMaxRank), pageMessages: messages, pageStatus: pageStatus)
    }

    var statusText: String {
        lock.lock(); defer { lock.unlock() }
        guard enabled else { return "" }
        return "AR: \(pageReady ? "ページ接続" : "ページ待ち") 姿勢 \(posesSent)(捨て \(posesSkipped)) フラッシュ \(flashes)" + (messages.last.map { $0.hasPrefix("fail") ? " \($0)" : "" } ?? "")
    }
}
