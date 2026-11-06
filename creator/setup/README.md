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

### 改行(Windows の CRLF と、Mac・Linux の LF)
- ④ は、文字のファイル(`.json`・`.md`・`.txt`・`.svg`・`.html`・`.css`・`.js`・`.mjs`・`.py`・`.sh`。`.gitattributes` の `text eol=lf` と同じ)の CRLF を LF にそろえてから sha256 を取る。なので、どの取り出し方でも同じ値になる。基準の値は git の中身(LF)と同じ。
- 作例に新しい種類の文字のファイルを足すときは、`.gitattributes` と `check_samples.py` の `TEXT` の両方に足す(片方だけだと、取り出し方で ④ が変わる)。
- 2026-11-07 まで `.svg` をそろえていなかった。基準が Windows の CRLF の形で取られていて、LF で取り出した木では `characters/yokoso/2d/body.svg` で ④ が落ちた。

改行に左右されない事の確かめ方(リポジトリの外に写しを作る。1 分):

```bash
git -c core.autocrlf=false -c core.eol=lf worktree add --detach <リポジトリの外の写し> <コミット>
cd <写し>
git ls-files --eol | grep -c "w/crlf"     # 0 なら LF の木(Mac・Linux と同じ)
python creator/setup/check_samples.py    # 結果: 合格
unix2dos characters/yokoso/2d/body.svg   # 1 本を CRLF に
python creator/setup/check_samples.py    # 結果: 合格
```

- Windows の Git では `core.autocrlf=false` だけでは足りない。`text=auto` のファイルは、既定の `core.eol`(CRLF)で取り出される。`core.eol=lf` も付ける(git 2.51 で測った)。
- 終わったら写しを外す(`git worktree remove <写し>`)。

## 確かめた事・確かめていない事
- 2026-11-07: LF で取り出した写し(文字のファイル 410 本が全部 LF)で「結果: 合格」。直す前の `check_samples.py` と基準に戻すと ④ が `body.svg` で落ちる(不合格 1)。写しの `body.svg` を CRLF にしても、作例の文字のファイル 10 本を全部 CRLF にしても「結果: 合格」。
- まだ: Mac・Linux の実機での `check_samples.py`(中身は Python だけなので動く見込み)。
