# リアルタイムの確認(端末の動きで UE のカメラを動かし、絵を端末へ返す)

C++ なしのプロジェクトで動く。Python と、エンジンに入っている Pixel Streaming 2 だけを使う。

```
端末 ── UDP(1 行の JSON)──▶ UE(-game)の Python が Cine Camera を動かす
端末 ◀── WebRTC ── Pixel Streaming 2 ◀── UE の絵          ページと接続の取り次ぎは signalling.py
```

| ファイル | 中身 |
|---|---|
| `build_live.py` | L_Comp を複製してレベル L_Live を作る(カメラ・遅れの印・床の光)。プロジェクトの写しで動かす |
| `live_camera.py` | UE の中で動く受け手。ポート 9000 の UDP で、カメラと画角を動かす。LED に映像を流し、キャラに動きを付ける |
| `live_math.py` | 姿勢 → UE の位置と向き。UE の中でも外でも動く。`test_live_math.py` が確かめ |
| `signalling.py` | Pixel Streaming の取り次ぎ(-game には内蔵が無い)と、ページの配信。ポート 8080(ページと端末)、8888(UE) |
| `player.html` | 絵を受けるページ。印の色の変化と WebRTC の統計を記録して返す |
| `fake_phone_udp.py` | 端末の代わりの送り手 |
| `live_ctl.py` | 動いている受け手への命令(recenter・align・media) |
| `measure_latency.py` | 遅れ・fps・コマ落ちを出す |
| `run_live.py` | 全部を起動して閉じる。止めるのは自分で起動した PID だけ |

## 動かし方

```sh
python run_live.py try --out <記録のフォルダ> --seconds 30    # 試しの送り手とブラウザで測って閉じる
python measure_latency.py <記録のフォルダ>
python run_live.py serve --out <記録のフォルダ> --lan --start-pos 130 1500 170    # 端末から見る
```

UDP の形: `{"t":秒,"T":[列順の16個],"K":[fx,fy,cx,cy],"w":幅,"h":高さ,"ok":真偽}`。ほかの項目は読まない。
`T` は y が上の右手系・m、カメラの軸は +x 右・+y 上・−z 前。

位置合わせは 2 通り: `--start-pos`(最初の 1 コマをその位置にする。相対で動く)か、`live_ctl.py align <撮影のフォルダ>`(LED の 4 隅)。
