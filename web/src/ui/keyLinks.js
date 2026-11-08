// 鍵を作る公式のページと、鍵を入れて起こす命令の 1 か所の置き場(画面の案内・READMEの試験が同じ物を見る)。
// - 公式のページだけ。値段や「お試し」の中身はここに書かない(変わるので、公式の料金のページへ向ける)。
// - 鍵そのものは、どこにも持たない。命令の「ここに鍵」は目印の文字。

/** 公式のページ(新しいタブで開く)。Claude の鍵を作る頁・声の会社の鍵の頁・声の会社の料金の頁 */
export const KEY_LINKS = Object.freeze({
  claudeKeys: 'https://platform.claude.com/settings/keys',
  voiceKeys: 'https://elevenlabs.io/app/api/api-keys',
  voicePricing: 'https://elevenlabs.io/pricing/api',
});

/** 鍵を入れて起こす命令(web のフォルダで流す)。「ここに鍵」は自分の鍵に替える目印 */
export const START_COMMANDS = Object.freeze({
  easy: 'npm run start:keys',
  unix: 'ANTHROPIC_API_KEY="ここに鍵" npm start',
  windows: '$env:ANTHROPIC_API_KEY="ここに鍵"; npm start',
  /** 鍵を使わず、自分の PC の Claude Code(ログイン済み)につないで起こす */
  claudeCode: 'npm run start:claude-code',
});

/** 声の鍵の欄の下に出す、1 行の注意(お試しのプランがあるかもしれない・公式で確かめる) */
export const VOICE_TRIAL_NOTE = 'おためしの プランが ある ことも。公式ページで たしかめてね。';
