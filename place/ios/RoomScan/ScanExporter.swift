import Foundation
import RoomPlan
import simd

/// 撮った部屋をファイルにする。
/// アプリの Documents/scans/<日時>/ に置く(Finder のファイル共有と共有シートで取り出せる):
///  - room_mesh.usdz        … 壁に窓・ドアの穴が開いた三角形の面(Blender などで開くならこちら)
///  - room_parametric.usdz  … 壁・物を単位の箱で出した版
///  - room.json             … CapturedRoom そのもの(名前・位置・寸法)。landmarks を作る元
///  - landmarks_hint.json   … ドア・窓・物の名前と中心の位置と寸法だけを抜いた短い版
enum ScanExporter {
    static func write(_ room: CapturedRoom) throws -> [URL] {
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.dateFormat = "yyyyMMdd-HHmmss"
        let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = docs.appendingPathComponent("scans/\(stamp.string(from: Date()))", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var urls: [URL] = []

        let meshURL = dir.appendingPathComponent("room_mesh.usdz")
        try room.export(to: meshURL, exportOptions: .mesh)
        urls.append(meshURL)

        let paramURL = dir.appendingPathComponent("room_parametric.usdz")
        try room.export(to: paramURL, exportOptions: .parametric)
        urls.append(paramURL)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let jsonURL = dir.appendingPathComponent("room.json")
        try encoder.encode(room).write(to: jsonURL)
        urls.append(jsonURL)

        let hintURL = dir.appendingPathComponent("landmarks_hint.json")
        try encoder.encode(hints(of: room)).write(to: hintURL)
        urls.append(hintURL)

        return urls
    }

    struct Hint: Codable {
        var kind: String          // door / window / opening / wall / object
        var name: String          // category の名前(door, table, sofa ...)
        var position: [Float]     // 部屋の座標での中心 [x, y, z](m)
        var dimensions: [Float]   // [幅, 高さ, 奥行き](m)
        var confidence: String
    }

    static func hints(of room: CapturedRoom) -> [Hint] {
        func hint(kind: String, name: String, transform: simd_float4x4, dimensions: simd_float3, confidence: CapturedRoom.Confidence) -> Hint {
            let c = transform.columns.3
            return Hint(kind: kind, name: name, position: [c.x, c.y, c.z],
                        dimensions: [dimensions.x, dimensions.y, dimensions.z],
                        confidence: "\(confidence)")
        }
        var out: [Hint] = []
        for s in room.doors { out.append(hint(kind: "door", name: "door", transform: s.transform, dimensions: s.dimensions, confidence: s.confidence)) }
        for s in room.windows { out.append(hint(kind: "window", name: "window", transform: s.transform, dimensions: s.dimensions, confidence: s.confidence)) }
        for s in room.openings { out.append(hint(kind: "opening", name: "opening", transform: s.transform, dimensions: s.dimensions, confidence: s.confidence)) }
        for s in room.walls { out.append(hint(kind: "wall", name: "wall", transform: s.transform, dimensions: s.dimensions, confidence: s.confidence)) }
        for o in room.objects { out.append(hint(kind: "object", name: "\(o.category)", transform: o.transform, dimensions: o.dimensions, confidence: o.confidence)) }
        return out
    }

    static func summary(of room: CapturedRoom) -> String {
        let objects = Dictionary(grouping: room.objects, by: { "\($0.category)" })
            .map { "\($0.key)×\($0.value.count)" }
            .sorted()
            .joined(separator: " ")
        return "壁 \(room.walls.count)・ドア \(room.doors.count)・窓 \(room.windows.count)・開口 \(room.openings.count)\n物: \(objects.isEmpty ? "なし" : objects)"
    }
}
