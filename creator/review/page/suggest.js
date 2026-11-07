// 描いた絵(C0)へのおすすめと、よく頼む直しの一言。スマホの確かめる画面(review.js)と PC の作る画面(make.js)の両方で使う。
// 本人 11/7: 眉のないキャラクターには、眉を足すのをすすめる(眉があると気持ちがちゃんと伝わる)。ステップごとに、押して選べるように。
// - 眉があるかは、PC のサーバーが絵の SVG の K1 の部品(brow_R・brow_L)から決める(束の look.brows。分からない時は null = 出さない)
// - 「足す」は、決まった一言で、ふつうのやり直しを始める(描き直しは頼んだ所だけ = 前の回とくらべる決まった確かめが効く)
// - 「足さない」は、この子にはもう出さない(この端末の中だけに覚える。覚えられない時は、この画面を開いている間だけ)
// - 文字は全部 textContent で入れる。押す所は 44px 以上(CSS)。キーボードと読み上げで使えるように、ボタンと名前つきの組だけで作る
export const BROW_TITLE = "眉を足しませんか?(おすすめ)";
export const BROW_WHY = "眉があると、うれしい・こまった・おこった などの気持ちが、ぐっと伝わりやすくなります";
export const BROW_CHOICES = [
  { id: "brow_normal", label: "足す(ふつう)", note: "眉を足す(ふつうの太さ)。ほかは変えない", primary: true },
  { id: "brow_thin", label: "足す(ほそめ)", note: "眉を足す(ほそめ)。ほかは変えない" },
  { id: "brow_thick", label: "足す(ふとめ)", note: "眉を足す(ふとめ)。ほかは変えない" },
  { id: "brow_no", label: "足さない", note: null },
];
/** おまかせ(ぜんぶ じどう)で選ぶ、眉のおすすめ */
export const BROW_AUTO = BROW_CHOICES[0];
/** よく頼む直し。押すと一言の欄に入る(送る前に書き直せる)。一言は描き直しの決まった確かめが読める言い方にする */
export const QUICK_NOTES = [
  { label: "眉を足す", note: "眉を足す(ふつうの太さ)。ほかは変えない" },
  { label: "目を大きく", note: "目を大きく。ほかは変えない" },
  { label: "色を明るく", note: "色を明るく。ほかは変えない" },
  { label: "小物を足す", note: "小物(かざり)を 1 つ足す。ほかは変えない" },
  { label: "形はそのまま色だけ変える", note: "色だけ変える。ほかは そのまま" },
];

const said = new Set(); // 覚えられない端末のため(この画面を開いている間)
const KEY = (id) => `yc-brow-no:${id}`;

/** この子に「足さない」を選んだか */
export function browDeclined(id) {
  if (!id) return false;
  if (said.has(id)) return true;
  try {
    return window.localStorage.getItem(KEY(id)) === "1";
  } catch {
    return false;
  }
}

export function declineBrow(id) {
  if (!id) return;
  said.add(id);
  try {
    window.localStorage.setItem(KEY(id), "1");
  } catch {
    /* 覚えられない端末(見るだけの窓など)。この画面を開いている間だけ */
  }
}

/** おすすめの札を出すか: 絵が SVG で眉が無いと分かった時だけ。分からない(null)時は出さない */
export function wantBrow(look, id) {
  return Boolean(look) && look.brows === false && !browDeclined(id);
}

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("data-") || k.startsWith("aria-") || ["type", "role", "id"].includes(k)) e.setAttribute(k, v);
    else e[k] = v;
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * 眉のおすすめの札。onPick(choice) は「足す」で呼ぶ(choice.note が決まった一言)。「足さない」は札を消して onNo()。
 * @param {{id:string, disabled?:boolean, onPick:(c:object)=>void, onNo?:()=>void, cls?:string}} o
 */
export function browCard({ id, disabled = false, onPick, onNo = () => {}, cls = "" }) {
  const card = el("section", { class: `sg-card ${cls}`.trim(), id: "browCard", "aria-labelledby": "browTitle", "data-sg": "brow" });
  card.append(el("h2", { class: "sg-title", id: "browTitle" }, BROW_TITLE), el("p", { class: "sg-why" }, BROW_WHY));
  const row = el("div", { class: "sg-btns", role: "group", "aria-label": "眉をどうする?" });
  for (const c of BROW_CHOICES) {
    const b = el("button", { type: "button", class: `sg-btn${c.primary ? " primary" : ""}${c.note ? "" : " no"}`, "data-choice": c.id, "aria-label": c.label });
    // 「足す(ふつう)」の「足す(」「)」は、狭い所(PC の背の低い枠)では見た目だけ隠す(読み上げの名前と文字はそのまま)
    const m = c.label.match(/^(足す\()(.+)(\))$/);
    if (m) b.append(el("span", { class: "sg-verb" }, m[1]), m[2], el("span", { class: "sg-verb" }, m[3]));
    else b.textContent = c.label;
    b.disabled = disabled;
    b.addEventListener("click", () => {
      if (!c.note) {
        declineBrow(id);
        card.remove();
        onNo();
        return;
      }
      onPick(c);
    });
    row.append(b);
  }
  card.append(row);
  return card;
}

/**
 * よく頼む直しの列。押すと input の値を決まった一言にして、欄へ戻る(送る前に書き直せる)。onFill は欄の数え直しなど
 * @param {{input:HTMLInputElement|HTMLTextAreaElement, onFill?:()=>void, cls?:string}} o
 */
export function quickChips({ input, onFill = () => {}, cls = "" }) {
  const row = el("div", { class: `sg-chips ${cls}`.trim(), role: "group", "aria-label": "よく頼む直し(押すと一言に入ります)" });
  for (const q of QUICK_NOTES) {
    const b = el("button", { type: "button", class: "sg-chip", "data-note": q.note }, q.label);
    b.addEventListener("click", () => {
      input.value = q.note;
      onFill();
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch {
        /* 選べない欄 */
      }
    });
    row.append(b);
  }
  return row;
}
