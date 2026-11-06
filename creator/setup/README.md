# 作る道の環境(契約 K0、版 1。2026-11-06 に固めた)

持ち主は S1(作る 3D)。変えるときは版を上げて、契約表に書く。

| 物 | 決めた版 | 根拠 |
|---|---|---|
| Blender | **5.2.0 LTS**(5.2 系) | 作例 4 体(ようこそくん・ロボくん・パネルくん・提灯くん)の `model.glb` の書き出しの印が 4 つとも `Khronos glTF Blender I/O v5.2.39`(5.2 の書き出し)。4.5 では作っていない |
| Node.js | 22 系(22.19.0 で確かめた) | `web/` の試験と組み立て |
| Python | 3.10 以降(3.10.11 で確かめた)と Pillow・NumPy・SciPy | `creator/pipeline/` の道具 |
| Chrome | 入っている物(ヘッドレスで SVG を PNG にする・ブラウザの検査) | 同梱しない |

## はじめに 1 回

```bash
python creator/setup/doctor.py --write --blender "<Blender 5.2 の実行ファイル>"
```

`creator/env.local.sh`(リポジトリに入れない)に道具の場所を書く。自動で見つかれば `--blender` は要らない。Blender が 2 つ入っているときは、5.2 を渡す。

## 作例 4 体の検査(合わせの前に毎回。1 秒、GPU を使わない)

```bash
python creator/setup/check_samples.py
```

① 契約 K1 の形(`creator/specs/validate_character.py`)② ビューアで動く形(`pk02_check_character.py`)③ GLB の大きさ(`pk03_glb_report.py`)④ 作例のファイルが決めた時と同じ(`samples_hash.json`、改行の違いは数えない)。全部通ると「結果: 合格」で終わりの番号 0。

作例をわざと作り直したときだけ `--write-hash` で基準を書き直し、コミットの文に理由を書く。

## 確かめていない事
- Mac・Linux での `check_samples.py`(中身は Python だけなので動く見込み。動かしていない)。
