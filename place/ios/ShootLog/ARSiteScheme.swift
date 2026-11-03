import Foundation
import UniformTypeIdentifiers
import WebKit

/// アプリの中の独自の URL(app://app/<パス>)で、AR モニターのページと部品(three.js・VRM・踊り・show_stage.json)を配る。ネットワークも ATS も要らない。
/// 探す順: ①Documents/ARSite/<パス>(曲が変わったとき、アプリを組み直さず devicectl で置き換えられる)②アプリに同梱の ARSite/<パス>(place/ios/tools/make_arsite.py が集める)。
final class ARSiteScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "sample"

    private static func mime(_ path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }

    private func fileURL(for path: String) -> URL? {
        let rel = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard !rel.contains("..") else { return nil }
        if let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false) {
            let u = docs.appendingPathComponent("ARSite").appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: u.path) { return u }
        }
        if let res = Bundle.main.resourceURL {
            let u = res.appendingPathComponent("ARSite").appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: u.path) { return u }
        }
        return nil
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { urlSchemeTask.didFailWithError(URLError(.badURL)); return }
        guard let file = fileURL(for: url.path), let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            urlSchemeTask.didReceive(r)
            urlSchemeTask.didReceive(Data("not found: \(url.path)".utf8))
            urlSchemeTask.didFinish()
            return
        }
        let headers = ["Content-Type": Self.mime(url.path), "Content-Length": "\(data.count)", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"]
        let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(r)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
