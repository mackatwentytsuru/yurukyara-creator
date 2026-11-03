import ARKit
import Foundation
import simd

/// LED に「点を 1 つずつ順に光らせる」校正の絵(place/shootlog/rehearsal/dot_calib.html。緑の点)を、カメラの映像から自動で拾い、点ごとに「カメラの位置から点への線(レイ)」を作る。
/// 手で 4 隅を押す代わり。ページ(ar_show.js)が、点の LED 上の位置(5×3 の格子、番号 = 行 * 5 + 列)と合わせて、世界 ← LED の変換を解く。
///
/// 点の見つけ方(実機の撮影を PC で再生して確かめた形):
///  ・輝度(8 ビット)と緑らしさ(max(0,128-Cb)+max(0,128-Cr))を 240×135 の格子で見て、輝度 70 以上・緑らしさ 70 以上・Cb と Cr がどちらも 118 未満・「ふだんの緑らしさ」(ゆっくり動く基準)が 40 未満のマスを候補にする。派手な壁紙(ピンク・紫)は緑でないので落ちる。
///  ・候補の塊のうち、面積 6〜400 マス・縦横比 0.6〜1.7・中身が詰まっている(面積 / 外接の四角 ≥ 0.55)ものだけを点とする。アイコン・文字・通知の四角・別のモニターは、小さい・細長い・すかすかで落ちる。
///  ・点が 2 コマ以上続いて消えたら 1 つの点(0.35 秒より長い塊は点でない=緑の物)。中ほどのコマの重心から、そのコマの姿勢と内部パラメータでレイを作る。
///  ・その間にカメラが速く動いたら(位置 3 cm 超か向き 2° 超)捨てる。追跡が normal でないときは全部捨てる(世界の座標がずれるので、前のレイと混ぜない)。30 秒より古いレイも捨てる。
/// 番号の合わせ方: 周の頭に面の全体が 0.4 秒緑に光る(合図。候補が 800 マス以上で、長さが 0.25〜0.6 秒)。合図が消えてからの時間で k = (t - 終わり - 0.4 - 0.1) / 0.3 と決める(点の中ほどの時刻で、ずれ 0.08 秒以内のものだけ使う)。
/// 数えて決めないので、一部の点が画面の外でも番号がずれない。点ごとに新しいレイを 3 本まで持つ。
final class DotCalibrator {
    static let cols = 5, rows = 3
    private let gw = 240, gh = 135
    private var base: [Float] = []
    private var inEvent = false
    private var quiet = 0
    private var frames: [(cx: Float, cy: Float, ts: Double, tf: simd_float4x4, k: simd_float3x3)] = []
    private var syncEnd: Double?          // 合図が消えた時刻(ARFrame.timestamp)
    private var inSync = false
    private var syncStart = 0.0
    private var rays: [Int: [(o: simd_float3, d: simd_float3, ts: Double)]] = [:]
    private var lastTs = 0.0
    private static let gapAfterSync = 0.4, step = 0.3, onTime = 0.2
    private(set) var syncCount = 0
    var total = 15                 // 点の数(自宅のモニター 5×3 = 15、会場の 3 面 = 33)
    private(set) var eventCount = 0

    /// 新しい点を 1 つ確定したとき true。
    func process(_ frame: ARFrame) -> Bool {
        lastTs = frame.timestamp
        guard case .normal = frame.camera.trackingState else {
            rays.removeAll(); syncEnd = nil; inSync = false; inEvent = false; frames = []
            return false
        }
        let pb = frame.capturedImage
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard CVPixelBufferGetPlaneCount(pb) > 1,
              let yAddr = CVPixelBufferGetBaseAddressOfPlane(pb, 0),
              let cAddr = CVPixelBufferGetBaseAddressOfPlane(pb, 1) else { return false }
        let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
        let ybpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 0), cbpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 1)
        var chroma = [Float](repeating: 0, count: gw * gh)   // 緑らしさ
        var lum = [Float](repeating: 0, count: gw * gh)
        var both = [Bool](repeating: false, count: gw * gh)  // Cb も Cr も 118 未満
        for gy in 0..<gh {
            let y = gy * h / gh + h / (2 * gh)
            let yrow = yAddr + y * ybpr
            let crow = cAddr + (y / 2) * cbpr
            for gx in 0..<gw {
                let x = gx * w / gw + w / (2 * gw)
                let i = gy * gw + gx
                lum[i] = Float(yrow.load(fromByteOffset: x, as: UInt8.self))
                let cb = Float(crow.load(fromByteOffset: (x / 2) * 2, as: UInt8.self))
                let cr = Float(crow.load(fromByteOffset: (x / 2) * 2 + 1, as: UInt8.self))
                chroma[i] = max(0, 128 - cb) + max(0, 128 - cr)
                both[i] = cb < 118 && cr < 118
            }
        }
        if base.count != gw * gh { base = chroma }
        var cand = [Bool](repeating: false, count: gw * gh)
        for i in 0..<(gw * gh) {
            let c = lum[i] >= 70 && chroma[i] >= 70 && both[i] && base[i] < 40
            cand[i] = c
            let a: Float = c ? 0.01 : 0.05
            base[i] = base[i] * (1 - a) + chroma[i] * a
        }
        let total = cand.reduce(0) { $0 + ($1 ? 1 : 0) }
        if total >= 800 {                // 合図
            if !inSync { syncStart = frame.timestamp }
            inSync = true
            inEvent = false
            frames = []
            return false
        }
        if inSync {                      // 合図が消えた
            inSync = false
            let len = frame.timestamp - syncStart
            if len >= 0.25 && len <= 0.6 { syncEnd = frame.timestamp; syncCount += 1 }
        }
        if let blob = bestBlob(cand) {
            if !inEvent { inEvent = true; frames = [] }
            quiet = 0
            frames.append((blob.x * Float(w) / Float(gw), blob.y * Float(h) / Float(gh), frame.timestamp, frame.camera.transform, frame.camera.intrinsics))
            return false
        }
        guard inEvent else { return false }
        quiet += 1
        guard quiet >= 2 else { return false }
        inEvent = false
        defer { frames = [] }
        guard frames.count >= 2, let syncEnd else { return false }
        guard frames.last!.ts - frames.first!.ts <= 0.35 else { return false }   // 長く続く物は点でない
        let f0 = frames.first!.tf, f1 = frames.last!.tf
        let moved = simd_length(simd_float3(f1.columns.3.x - f0.columns.3.x, f1.columns.3.y - f0.columns.3.y, f1.columns.3.z - f0.columns.3.z))
        let r = simd_float3x3(simd_float3(f0.columns.0.x, f0.columns.0.y, f0.columns.0.z), simd_float3(f0.columns.1.x, f0.columns.1.y, f0.columns.1.z), simd_float3(f0.columns.2.x, f0.columns.2.y, f0.columns.2.z)).transpose
            * simd_float3x3(simd_float3(f1.columns.0.x, f1.columns.0.y, f1.columns.0.z), simd_float3(f1.columns.1.x, f1.columns.1.y, f1.columns.1.z), simd_float3(f1.columns.2.x, f1.columns.2.y, f1.columns.2.z))
        let cosA = min(1, max(-1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2))
        guard moved <= 0.03, acos(cosA) <= 2 * .pi / 180 else { return false }      // 動いている間のレイは使わない
        let ev = frames[frames.count / 2]
        let mid = (frames.first!.ts + frames.last!.ts) / 2
        let q = (mid - syncEnd - Self.gapAfterSync - Self.onTime / 2) / Self.step
        let k = Int(q.rounded())
        guard abs(q - q.rounded()) * Self.step <= 0.08, k >= 0, k < total else { return false }
        let fx = ev.k[0][0], fy = ev.k[1][1], cx = ev.k[2][0], cy = ev.k[2][1]
        let dc = simd_float4((ev.cx - cx) / fx, -(ev.cy - cy) / fy, -1, 0)
        let dw4 = ev.tf * dc
        let d = simd_normalize(simd_float3(dw4.x, dw4.y, dw4.z))
        let o = simd_float3(ev.tf.columns.3.x, ev.tf.columns.3.y, ev.tf.columns.3.z)
        var list = rays[k] ?? []
        list.append((o, d, mid))
        if list.count > 3 { list.removeFirst() }
        rays[k] = list
        eventCount += 1
        return true
    }

    /// 候補のマスから、丸くてまとまった最大の塊の重心(格子の座標。マスの中心を +0.5)を返す。
    private func bestBlob(_ cand: [Bool]) -> (x: Float, y: Float)? {
        var label = [Int32](repeating: 0, count: gw * gh)
        var best: (area: Int, x: Float, y: Float)?
        var next: Int32 = 1
        var stack: [Int] = []
        for start in 0..<(gw * gh) where cand[start] && label[start] == 0 {
            var area = 0
            var sx = 0, sy = 0
            var minX = gw, maxX = 0, minY = gh, maxY = 0
            stack.append(start)
            label[start] = next
            while let p = stack.popLast() {
                let px = p % gw, py = p / gw
                area += 1; sx += px; sy += py
                minX = min(minX, px); maxX = max(maxX, px); minY = min(minY, py); maxY = max(maxY, py)
                for dy in -1...1 {
                    for dx in -1...1 where dx != 0 || dy != 0 {
                        let nx = px + dx, ny = py + dy
                        guard nx >= 0, nx < gw, ny >= 0, ny < gh else { continue }
                        let q = ny * gw + nx
                        if cand[q] && label[q] == 0 { label[q] = next; stack.append(q) }
                    }
                }
            }
            next += 1
            guard area >= 6, area <= 400 else { continue }
            let bw = maxX - minX + 1, bh = maxY - minY + 1
            let aspect = Float(bw) / Float(bh)
            guard aspect >= 0.6, aspect <= 1.7, Float(area) / Float(bw * bh) >= 0.55 else { continue }
            if best == nil || area > best!.area { best = (area, Float(sx) / Float(area) + 0.5, Float(sy) / Float(area) + 0.5) }
        }
        return best.map { ($0.x, $0.y) }
    }

    /// ページの onCalibration に渡す形。
    func json() -> String? {
        let now = lastTs
        let arr: [[String: Any]] = rays.flatMap { (k, list) in
            list.filter { now - $0.ts <= 30 }.map { ["face": "A", "id": "dot\(k)", "dot": k, "origin": [Double($0.o.x), Double($0.o.y), Double($0.o.z)], "direction": [Double($0.d.x), Double($0.d.y), Double($0.d.z)]] as [String: Any] }
        }
        guard !arr.isEmpty, let data = try? JSONSerialization.data(withJSONObject: arr) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    var dotCount: Int { rays.values.filter { $0.contains { lastTs - $0.ts <= 30 } }.count }
}
