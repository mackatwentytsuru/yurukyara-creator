import ARKit
import Foundation
import simd

/// 撮影記録の中身の形。frames.jsonl(コマごと)と meta.json(撮影ぜんたい)に書く。
/// 座標の約束(PC 側の道具 place/shootlog/ も同じ前提):
///  - T … ARKit の世界座標でのカメラの姿勢(カメラ→世界、4x4、列順に 16 個)。世界は重力に合わせた右手系で y が上、m。
///  - カメラの座標は「+x が画像の右、+y が上、−z が前」。画像は iPhone を横(ホームバーが右)に持ったときの向きのまま(回していない)。
///  - K … [fx, fy, cx, cy] を画素で(原点は画像の左上、y は下向き)。画像の大きさは meta.json の video.width/height。
///    画素 (u,v) は、カメラ座標の点 (X,Y,Z)(Z<0)に対して u = cx + fx·X/(−Z)、v = cy − fy·Y/(−Z)。
enum Pack {
    static func flat(_ m: simd_float4x4) -> [Float] {
        let c = m.columns
        return [c.0, c.1, c.2, c.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }

    static func flat(_ v: simd_float3) -> [Float] { [v.x, v.y, v.z] }

    static func intrinsics(_ camera: ARCamera) -> [Float] {
        let k = camera.intrinsics
        return [k[0][0], k[1][1], k[2][0], k[2][1]]
    }

    static func camera(_ frame: ARFrame) -> CameraSample {
        CameraSample(
            T: flat(frame.camera.transform),
            K: intrinsics(frame.camera),
            w: Int(frame.camera.imageResolution.width),
            h: Int(frame.camera.imageResolution.height)
        )
    }

    /// 追跡の状態を文字にする。ok は「正常」のときだけ true(limited は姿勢がずれているかもしれない)。
    static func tracking(_ state: ARCamera.TrackingState) -> (text: String, ok: Bool) {
        switch state {
        case .normal: return ("normal", true)
        case .notAvailable: return ("notAvailable", false)
        case .limited(let reason):
            switch reason {
            case .initializing: return ("limited:initializing", false)
            case .excessiveMotion: return ("limited:excessiveMotion", false)
            case .insufficientFeatures: return ("limited:insufficientFeatures", false)
            case .relocalizing: return ("limited:relocalizing", false)
            @unknown default: return ("limited:other", false)
            }
        }
    }

    static func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
        }
    }
}

struct CameraSample: Codable {
    var T: [Float]
    var K: [Float]
    var w: Int
    var h: Int
}

struct PlaneInfo: Codable {
    var id: String
    var alignment: String   // horizontal / vertical
    var T: [Float]
    var extent: [Float]     // [x, z](平面のローカル)
    var center: [Float]
}

struct FloorMark: Codable {
    var sessionTime: Double
    var point: [Float]?     // 床に十字を向けたとき、レイが当たった世界座標
    var planeY: Float       // 床とみなした高さ(当たった点の y。当たらなければ一番低い水平面の y)
    var camera: CameraSample
    var planes: [PlaneInfo]
}

struct CornerMark: Codable {
    var id: String          // tl / tr / br / bl(客席から LED を見て 左上・右上・右下・左下)
    var label: String
    var sessionTime: Double
    var videoFrame: Int?    // 録画中に記録したときのコマ番号
    var camera: CameraSample
    var rayOrigin: [Float]
    var rayDirection: [Float]
    var hit: [Float]?       // 十字の先のレイが当たった世界座標(LED が面として取れたときだけ)
    var hitKind: String?
}

struct Calibration: Codable {
    var floor: FloorMark?
    var corners: [CornerMark] = []
}

struct ShootEvent: Codable {
    var t: Double           // ARFrame.timestamp と同じ時計(起動からの秒)
    var kind: String
}

struct FormatInfo: Codable {
    var width: Int
    var height: Int
    var fps: Int
    var device: String
}

struct ShootStats: Codable {
    var frames: Int
    var droppedFrames: Int
    var droppedAtSeconds: [Double]
    var trackingNotNormalFrames: Int
    var durationSeconds: Double
    var averageFps: Double
    var width: Int
    var height: Int
    var firstSessionTimestamp: Double?
    var writerError: String?
}

struct ShootMeta: Codable {
    var format = "sample-shootlog/1"
    var startedAt: String
    var device: String
    var systemVersion: String
    var videoFile = "video.mov"
    var framesFile = "frames.jsonl"
    var chosenFormat: FormatInfo?
    var supportedFormats: [FormatInfo]
    var autoFocus: Bool
    var calibration: Calibration
    var events: [ShootEvent]
    var stats: ShootStats
    var conventions: [String: String]

    static let conventionText: [String: String] = [
        "T": "カメラ→世界の 4x4(列順 16 個)。世界は重力に合わせた右手系、y が上、m",
        "camera_axes": "+x が画像の右、+y が上、-z が前。画像は横持ち(ホームバーが右)のまま回していない",
        "K": "[fx, fy, cx, cy] 画素。原点は画像の左上、y は下向き。u = cx + fx*X/(-Z)、v = cy - fy*Y/(-Z)",
        "t": "ARFrame.timestamp(端末の起動からの秒)。video.mov の時刻 pts = t - 最初の t",
        "ok": "追跡が正常(normal)のコマだけ true。false のコマの T は信用しない",
    ]
}
