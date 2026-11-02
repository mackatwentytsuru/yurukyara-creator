import ARKit
import UIKit
import WebKit

/// iPhone の Safari に WebXR が無いので、ARKit の上に透明な WKWebView を重ねて、同じ Web ページを AR で見せる殻。
/// 約束(place/web/nativeAR.js と同じ):
///   殻 → ページ: window.__arhost.onPose(world16, projection16) / onHit(x,y,z) / onFloor(y)
///   ページ → 殻: webkit.messageHandlers.arhost.postMessage({type:'ready'|'raycast', x, y})
final class ARHostController: UIViewController, ARSessionDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private let sceneView = ARSCNView()
    private var webView: WKWebView!
    private let statusLabel = UILabel()
    private var pageURL: URL?
    private var floorPlaneY: [UUID: Float] = [:]
    private var lastSentFloor: Float?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        // カメラ映像と姿勢の追跡だけ。SceneKit の中身は何も置かない(3D はページの three.js が描く)。
        sceneView.frame = view.bounds
        sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sceneView.automaticallyUpdatesLighting = false
        sceneView.session.delegate = self
        view.addSubview(sceneView)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "arhost")
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view.addSubview(webView)

        statusLabel.numberOfLines = 0
        statusLabel.textColor = .white
        statusLabel.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textAlignment = .center
        statusLabel.frame = CGRect(x: 8, y: 50, width: view.bounds.width - 16, height: 0)
        statusLabel.autoresizingMask = [.flexibleWidth]
        view.addSubview(statusLabel)

        if let s = Bundle.main.object(forInfoDictionaryKey: "ARStageURL") as? String, let u = URL(string: s), u.host != nil {
            pageURL = u
            setStatus("読み込み中: \(u.host ?? "")")
            webView.load(URLRequest(url: u))
        } else {
            setStatus("開くページの URL が設定されていません(ビルド時の ARSTAGE_URL)")
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        config.planeDetection = [.horizontal]
        sceneView.session.run(config)
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    private func setStatus(_ text: String?) {
        statusLabel.text = text
        statusLabel.isHidden = (text == nil)
        if text != nil {
            let h = statusLabel.sizeThatFits(CGSize(width: statusLabel.bounds.width, height: .greatestFiniteMagnitude)).height
            statusLabel.frame.size.height = h + 8
        }
    }

    // MARK: - 姿勢を毎フレームページへ

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let size = webView.bounds.size
        guard size.width > 0 else { return }
        let view = frame.camera.viewMatrix(for: .portrait)
        let world = simd_inverse(view)
        let proj = frame.camera.projectionMatrix(for: .portrait, viewportSize: size, zNear: 0.05, zFar: 50)
        let js = "window.__arhost&&window.__arhost.onPose(\(Self.array(world)),\(Self.array(proj)))"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private static func array(_ m: simd_float4x4) -> String {
        let c = m.columns
        let v = [c.0, c.1, c.2, c.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
        return "[" + v.map { String(format: "%.5f", $0) }.joined(separator: ",") + "]"
    }

    // MARK: - 床の高さ

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { updatePlanes(anchors) }
    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { updatePlanes(anchors) }

    private func updatePlanes(_ anchors: [ARAnchor]) {
        for a in anchors {
            guard let p = a as? ARPlaneAnchor, p.alignment == .horizontal else { continue }
            floorPlaneY[p.identifier] = p.transform.columns.3.y
        }
        // いちばん低い水平面を床とみなす(机の上の面を床にしないため)
        guard let y = floorPlaneY.values.min() else { return }
        if let last = lastSentFloor, abs(last - y) < 0.01 { return }
        lastSentFloor = y
        webView.evaluateJavaScript("window.__arhost&&window.__arhost.onFloor(\(String(format: "%.4f", y)))", completionHandler: nil)
    }

    // MARK: - ページからの問い合わせ

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            setStatus(nil)
        case "raycast":
            guard let nx = (body["x"] as? NSNumber)?.doubleValue, let ny = (body["y"] as? NSNumber)?.doubleValue else { return }
            let point = CGPoint(x: nx * sceneView.bounds.width, y: ny * sceneView.bounds.height)
            guard let query = sceneView.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .horizontal),
                  let hit = sceneView.session.raycast(query).first else { return }
            let t = hit.worldTransform.columns.3
            webView.evaluateJavaScript("window.__arhost&&window.__arhost.onHit(\(t.x),\(t.y),\(t.z))", completionHandler: nil)
        default:
            break
        }
    }

    // MARK: - マイクとカメラの許可(開いているページの持ち主だけ)

    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == pageURL?.host ? .grant : .deny)
    }

    // MARK: - 読み込みの失敗の表示と、開発中の自己署名の証明書

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        setStatus("読み込めない: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        setStatus("読み込めない: \(error.localizedDescription)")
    }

    /// 開発中は、PC の自己署名の証明書を、開くはずのホストに限って信用する。
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        if space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = space.serverTrust, space.host == pageURL?.host {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
