# ゆるキャラクリエイター

**写真(絵)1 枚 → 3D のキャラ → すぐ話せる。** ゆるキャラの絵を 1 枚渡すと、Claude Code が 3D・骨・顔・動きを作り、ブラウザでそのまま話しかけられるところまで進めます。

Built with Claude: Japan 2026 の作品です。2026-11-02 12:30 以降に新しく書いています。使う AI は Claude(Claude Code と Claude API)だけです。声だけ ElevenLabs を使います。

## 始め方

1. このリポジトリを Claude Code で開きます。
2. 自分の鍵を、環境変数に入れます(ファイルやリポジトリには書きません)。
   - `ANTHROPIC_API_KEY`: キャラの頭脳(`claude-haiku-5-5`)。無いと、同じ形で返す仮の頭脳になります。
   - `ELEVENLABS_API_KEY`: キャラの声。無いと、字幕と口パクだけになります。
3. 道具を確かめます: `python creator/setup/doctor.py`(Blender 5.2 以降・Python・Chrome を調べます)。
4. 「この絵を話すキャラにして」と頼みます。入口のスキルは `.claude/skills/talking-character/SKILL.md` です。
5. 話す画面を動かします。

```bash
cd web
npm install        # 顔の追従用のモデルを public/mediapipe に取ります(リポジトリには入れません)
npm run build
npm run server     # http://localhost:8787/?character=yokoso
```

作例のキャラは `characters/` の `yokoso`(ようこそくん)、`robo`(ロボくん)、`d_lantern`、`f_led` です。`?character=<id>` で切り替えます。

## 使っているモデル(正直に)

| 役目 | 何を使うか |
|---|---|
| キャラを作る・判定する | Claude(Claude Code)。判定は別の文脈の Claude(Haiku 5.5 と Sonnet 5.5) |
| キャラの頭脳(会話) | Claude API(`claude-haiku-5-5`) |
| キャラの声 | **ElevenLabs**(読み上げ。`eleven_flash_v2_5`)。Claude の声ではありません |
| 聞き取り(声 → 文字) | 次の 2 つのどちらか。①ブラウザ内蔵の音声認識(Chrome は Google、Safari は Apple のサービスに音が送られます)。②サーバーの中の faster-whisper(OpenAI の Whisper の公開モデル `small` を、この PC の中で動かします。音は外へ送りません。Quest 3 のブラウザ用) |
| 顔の追従 | MediaPipe Face Landmarker(Google。端末の中だけで動き、映像は送りません) |

生成 AI として外へ送るのは、Claude API と ElevenLabs だけです。聞き取りと顔の検出は、小さな機械学習のモデルです。

## 7 つの段(スキル)

絵 1 枚から話すところまでを、7 つの段に分けています。段ごとに、使うスキルと道具があります。

| 段 | 内容 | 今ある物 |
|---|---|---|
| ① 写真を見る | 絵を、決まった式で測り、材質を決まった質問票で判断する | 準備中(スキルはまだありません) |
| ② モデリング | 部品の一覧から、Blender の Python で形を組む | `hand-built-character`、`creator/builders/` |
| ③ 素材・材質 | 布・毛・樹脂など、材質を決める | `hand-built-character`(毛の殻・材質の節) |
| ④ テクスチャ | 色・柄・文字の帯を貼る | `hand-built-character`、`creator/viewer/` |
| ⑤ リギング | 骨・重み・顔の形(口・まばたき)を入れる | `creator/pipeline/b03_rig.py` ほか |
| ⑥ アニメ | idle・talk・nod・wave・bow などの動きを作る | `creator/pipeline/b04_motions.py` ほか |
| ⑦ キオスクで喋る | 声・字幕・口・表情で話す | `talking-character`、`web/` |

作り手以外の目として、別の Claude が「同じキャラに見えるか・色・部品」を判定します(`creator/pipeline/j01_judge.py`)。

## できることと、できないこと(2026-11-04 時点)

- **できること(判定と測定で確かめた)**: 丸い頭と胴に短い手足の形、球や箱の胴。元の絵と「同じキャラに見えるか」は、残っている絵の 34 束すべてで通り、色が近いかは 32 束で通った(判定役は Claude の Haiku 5.5 と Sonnet 5.5。新しい題材 4 体で 4/4 など。同じ系統の判定役なので独立した確認ではない)。骨・動き・口と表情・声と字幕で話すところまで、人の手なしで通った(2 体、[カバー率](docs/カバー率.md))。macOS でも通った。ロボット(ロボくん)は、同じキャラは通ったが、色は Haiku が落とした。
- **できないこと・未確認**: 布の毛足の質感は、Claude の判定が通らなかった(14 束中 0)。帽子・耳・たすき・くちばし・翼・花・マント・角・胸の文字などの細部も、判定が通らず、確認済みにできていない。人の顔や人型の体は、この手順では質が出ない。
- **Quest 3 の VR**: 偽の WebXR では動いたが、実機では確かめていない。

数字と根拠は [docs/カバー率.md](docs/カバー率.md)、試した順の記録は [docs/devlog_キャラ.md](docs/devlog_キャラ.md) と [docs/devlog_会話.md](docs/devlog_会話.md)、部品とライセンスは [docs/部品の一覧.md](docs/部品の一覧.md) にあります。

## フォルダ

| フォルダ | 中身 |
|---|---|
| `creator/` | 絵から 3D のキャラを作る道具(builders・pipeline・viewer・setup) |
| `characters/` | 作ったキャラ(`character.json`・モデル・動き・persona) |
| `web/` | ブラウザで話す本体(頭脳・声・追従・表情)。[web/README.md](web/README.md) |
| `docs/` | 記録・決まり・部品の一覧 |
| `.claude/skills/` | Claude Code のスキル |

## 別の線(archive)

3 本柱の時代のコード(場所の再現・ショー・入口のキオスク)は、git の線 `before-pivot` に残してあります。この main には入っていません。
