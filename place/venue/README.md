# 箱の見え方(場所の柱の、期間中に作った部分)

何か: サンプル会場の LED(A・B・C の 3 面。中央の B 面は後ろへへこみ、C の端は曲がる)に映像を貼ったとき、座席の目から見てどう見えるか・演者がどこを隠すかを、リハーサルの日より前に確かめる。箱の形は `show/ue/stage_layout.py`(ショーの柱が期間中に実測から作った数字。ここでは読むだけ)。図面から前に作った UE の箱は使わない。

## 部品

| ファイル | やること |
|---|---|
| `venue.py` | 座席の目 → LED の各点の線が、演者(円柱)・舞台に遮られるか、見る角度(cos)。numpy だけ。`venue_selftest.py` が手計算と合うかを確かめる |
| `scenario.json` | 座席 2 か所・演者の立ち位置 2 通り(**仮の値**。座席表を測ったら差し替える) |
| `export_geometry.py` | LED の板・舞台を `place/web/venue_data.json` に書く |
| `place/web/venue_sim.html` | ブラウザのシミュレーター。`?seat=seat1&perf=perf1&media=<LED の絵>&details=<venue_details.json>` |
| `venue_report.py` | 座席 × 演者ごとに、座席から見た絵・隠れる所の絵(赤=演者に隠れる、青=見る角度が斜めすぎる)・数字を作る |
| `claude_review.py` | 上の絵と数字を Claude に渡し、見え方の問題を指摘させる(安全に関わることは「人が判断する」印つき) |
| `../shootlog/scene_reader.py` | iPhone の撮影から Claude が箱の中の物の足元を読み、床の位置にする → `venue_details.json` → シミュレーターに物が立つ |
| `scene_reader_selftest.py` | 合成の撮影(シミュレーターの絵 6 枚)で、読んだ位置を正解と比べる |
| `side_by_side.py` | 実写の 1 コマと、同じカメラの位置で描いた絵を並べ、盤の角の差を測る |
| `side_by_side_selftest.py` | 合成の「実写」で、ページの形が計算と合うかを確かめる |

## 動かし方

```sh
python place/venue/venue_selftest.py
python place/venue/export_geometry.py
python place/venue/venue_report.py --media <LED の絵 5680x1240 の png> --out <出力フォルダ>
python place/venue/claude_review.py --report <出力フォルダ>        # 環境変数 CLAUDE_CREDIT_API_KEY(_2)
python place/shootlog/scene_reader.py <撮影フォルダ> --out <出力フォルダ> --alignment <alignment_A.json> --face A
python place/venue/side_by_side.py <撮影フォルダ> --frame <番号> --alignment <alignment_A.json> --board <board_A.json> --media <LED の絵> --out <出力フォルダ>
```

## 言えること・言えないこと

- 座席の位置・演者の位置は仮。実測の座席表に差し替えるまで、「この席ではこう見える」とは言わない。
- 実写との一致は、サンプル会場で撮った盤の写真が来て `side_by_side.py` を流すまで **未測定**。合成の「実写」での確かめ(ページの形と計算の合い)は、実写の精度ではない。
- Claude の指摘は、絵と数字にあることだけ。安全の気づきは人が判断する。
