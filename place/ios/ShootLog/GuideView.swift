import UIKit

/// 「いま LED のどの角を狙うか」の小さな絵。客席から見た LED の四角(3 面なら A・B・C)に、角の順番 1〜4 を出し、
/// 記録した角は緑、いま狙う角は赤、これからの角は白の輪で示す。
final class GuideView: UIView {
    var faces = 3 { didSet { setNeedsDisplay() } }
    var done = 0 { didSet { setNeedsDisplay() } }      // 記録した角の数
    var floorDone = false { didSet { setNeedsDisplay() } }

    private static let widthsM: [CGFloat] = [5.12, 7.04, 10.56]   // A・B・C 面の横(m)。縦はどれも 4.96 m
    private static let names = ["A", "B", "C"]

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor.black.withAlphaComponent(0.6)
        layer.cornerRadius = 8
        isUserInteractionEnabled = false
        isOpaque = false
    }

    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ rect: CGRect) {
        let title = floorDone ? "客席から見た LED(赤い角をいま狙う)" : "まず床。そのあと LED の角を 1→2→3→4"
        (title as NSString).draw(at: CGPoint(x: 8, y: 4), withAttributes: [.font: UIFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: UIColor.white])

        let widths = faces == 1 ? [CGFloat(1.0)] : Array(Self.widthsM.prefix(3))
        let aspect: CGFloat = faces == 1 ? 0.62 : 4.96     // 1 面は仮の縦横比
        let total = widths.reduce(0, +)
        let pad: CGFloat = 10
        let gap: CGFloat = faces == 1 ? 0 : 5
        let availW = rect.width - pad * 2 - gap * CGFloat(widths.count - 1)
        var scale = availW / total
        var h = faces == 1 ? availW * aspect : 4.96 * scale
        let maxH = rect.height - 40
        if h > maxH {
            scale *= maxH / h
            h = maxH
        }
        let used = faces == 1 ? availW : total * scale + gap * CGFloat(widths.count - 1)
        var x = (rect.width - used) / 2
        let top: CGFloat = 22
        var index = 0
        for (f, wUnits) in widths.enumerated() {
            let w = faces == 1 ? availW : wUnits * scale
            let r = CGRect(x: x, y: top, width: w, height: h)
            UIColor(white: 1, alpha: 0.12).setFill()
            UIBezierPath(rect: r).fill()
            UIColor.white.setStroke()
            let outline = UIBezierPath(rect: r)
            outline.lineWidth = 1
            outline.stroke()
            let corners = [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
            for (k, p) in corners.enumerated() {
                let n = f * 4 + k
                let state: Int = !floorDone ? 2 : (n < done ? 0 : (n == done ? 1 : 2))   // 0 記録済 1 いま 2 これから
                let radius: CGFloat = state == 1 ? 7 : 5
                let dot = UIBezierPath(ovalIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2))
                switch state {
                case 0: UIColor.systemGreen.setFill(); dot.fill()
                case 1: UIColor.systemRed.setFill(); dot.fill(); UIColor.white.setStroke(); dot.lineWidth = 2; dot.stroke()
                default: UIColor.white.setStroke(); dot.lineWidth = 1.5; dot.stroke()
                }
                let num = "\(k + 1)" as NSString
                let off: CGFloat = 9
                let tx = k == 0 || k == 3 ? p.x + off : p.x - off - 6
                let ty = k < 2 ? p.y + 2 : p.y - 14
                num.draw(at: CGPoint(x: tx, y: ty), withAttributes: [.font: UIFont.systemFont(ofSize: 10, weight: .bold), .foregroundColor: state == 1 ? UIColor.systemRed : UIColor.white])
            }
            if faces > 1 {
                (Self.names[f] as NSString).draw(at: CGPoint(x: r.midX - 4, y: r.midY - 8), withAttributes: [.font: UIFont.systemFont(ofSize: 15, weight: .bold), .foregroundColor: UIColor(white: 1, alpha: 0.7)])
            }
            x += w + gap
            index += 1
        }
    }
}
