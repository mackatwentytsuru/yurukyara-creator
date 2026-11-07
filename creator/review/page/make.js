// 作る画面(初めての会話の 1〜3 歩の中に、枠で出す)。この PC のサーバー(serve_review.py --make)が配る。
// 言葉か絵 1 枚をこの PC の作る道へ渡し、ゆるキャラチェック → 段 0 の絵(C0)→「この子にする」/「直したい(一言)」/「やり直す」を、
// この画面の中だけで扱う。親の画面(会話の画面)には、状態の知らせ(postMessage)だけを送る。絵・合言葉は親に送らない。
// - 合言葉は枠の URL の # の後ろ(k=)で受け、見出し X-YC-Key で送る(枠の中は Cookie が使えない)。読んだら # を消す。
// - データから来る文字は全部 textContent で入れる。
// - 眉の無い絵には、眉を足すおすすめの札を出す。一言の欄の横に、よく頼む直しの列(押すと欄に入る)。おまかせ(ぜんぶ じどう)は、
//   残りの選びを全部おすすめで決めて最後まで進む(言葉はおまかせの一言・チェックはおすすめ・眉は足す(ふつう)・絵は OK。本人 11/7)
import { BROW_AUTO, browCard, quickChips, wantBrow } from "/r/assets/suggest.js";
import { MATERIALS, SHAPES } from "/r/assets/shapes.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const KEY = params.get("k") || "";
// view=pic: 「この子にする」の後、会話の画面の札の上に小さく出す枠。描いた絵だけを見せる(ボタン・知らせなし。D5)
const PIC_ONLY = params.get("view") === "pic";
// view=convert: 会話の札で形(shape)と しつかん(mat)を選んだ後の枠。変換の絵を頼み、描けたら見せて OK を受ける(B4 12b)
const CONVERT = params.get("view") === "convert" ? { cid: params.get("cid") || "", shape: params.get("shape") || "atama", material: params.get("mat") || "fabric" } : null;
// 役目(この子は、どこで だれと)と、お店・駅の名前。会話の札で選んだ物を、作って の頼みに入れる(B4 12b)
const ROLE = ["home", "shop", "station", "facility"].includes(params.get("role")) ? params.get("role") : "home";
const PLACE = [...String(params.get("place") || "")].slice(0, 30).join("");
const PARENT = (() => {
  const p = params.get("p") || "";
  try {
    return new URL(p).origin === p ? p : "";
  } catch {
    return "";
  }
})();
history.replaceState(null, "", location.pathname); // 合言葉をアドレスの欄と履歴に残さない

const S = { phase: "input", id: null, drawn: 0, ticket: null, hash: null, check: null, checkTold: false, seenAt: 0, lastAct: null, busy: false,
  wordsMax: 60, noteMax: 40, redoMax: 3, shownTicket: null, name: "", picUrl: null, look: null, auto: false, autoBrow: false };
/** おまかせ(ぜんぶ じどう)で作る時の言葉 */
/** 4 枚目の絵の後は、もう直せない(サーバーも断る) */
const overLimit = () => S.drawn > S.redoMax;
const OMAKASE_WORDS = "まるくて げんきな ゆるキャラ";
const SIDE = 1254;
const chars = (s) => [...String(s ?? "")].length;

/** 親の画面へ、状態の知らせだけを送る(決めた欄だけ。絵・合言葉は入れない) */
function tell(ev, data = {}) {
  if (PARENT && window.parent !== window) window.parent.postMessage({ src: "yc-make", ev, ...data }, PARENT);
}

async function api(path, opts = {}) {
  // 書き込みは 1 秒に 1 回まで(サーバーの決まり)。おまかせ・すばやい 2 回押しで断られたら、少し待って 1 回だけ送り直す(B4 12b)
  try {
    return await apiOnce(path, opts);
  } catch (e) {
    if (e.reason !== "rate" || opts.method !== "POST") throw e;
    await new Promise((r) => setTimeout(r, 1300));
    return apiOnce(path, opts);
  }
}

async function apiOnce(path, { method = "GET", body = null, blob = false } = {}) {
  const headers = { "X-YC-Key": KEY };
  if (body) Object.assign(headers, { "Content-Type": "application/json", "X-YC": "1" });
  let r;
  try {
    r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "omit" });
  } catch {
    throw new Error("パソコンに つながらないよ。パソコンの じゅんびが できているか、見てもらってね");
  }
  if (blob && r.ok) return r.blob();
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `PC が断りました(${r.status})`), { reason: j.reason });
  return j;
}

function show(phase) {
  S.phase = phase;
  $("mk").dataset.phase = phase;
  for (const p of ["input", "waiting", "check", "c0", "done", "convert"]) $(p).hidden = p !== phase;
  // 画面が替わったら、前の赤い断りの文を消す(前の画面の断りが、次の画面に残っていた。低 15)。頼みの下書きも前の子の物は残さない
  $("err").textContent = "";
  $("err").hidden = true;
  // 頼んでいない所も変わったという知らせは、絵の画面の 2 つの列の外(一番上)に出す(列が左の細い列に崩れていた。中 11)
  $("drift").hidden = !(phase === "c0" && S.drift);
}

function error(msg) {
  $("err").textContent = msg || "";
  $("err").hidden = !msg;
  if (msg) tell("error", { message: String(msg).slice(0, 120) });
}

/** 使える絵の形(画面の説明と、読めなかった時の知らせに出す。CRITux2 低 5) */
const FORMATS = "PNG・JPEG・WebP・SVG";
const SVG_MAX = 2 * 1024 * 1024; // SVG の文字の上限(2MB)
const isSvg = (f) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name || "");

/** 白い下地に描いて、長い辺 1254 までの jpeg にする */
function toJpeg(src, w, h) {
  const s = Math.min(1, SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

/**
 * SVG の絵(Claude が描く絵も SVG)を、この画面の中で絵にする。createImageBitmap は SVG を読めないので img で読む
 * (img の中の SVG は台本を動かさない)。大きさが書いていない SVG は、viewBox の縦横の比で長い辺を 1254 にする
 */
async function svgPicture(file) {
  if (file.size > SVG_MAX) throw new Error("big");
  const text = await file.text();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const img = document.createElement("img");
    img.src = url;
    await img.decode();
    const vb = text.match(/viewBox\s*=\s*["']\s*[-+\d.eE]+[\s,]+[-+\d.eE]+[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/);
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) {
      const r = Number(vb[1]) / Number(vb[2]);
      [w, h] = r >= 1 ? [SIDE, SIDE / r] : [SIDE * r, SIDE];
    } else if (!(w > 0 && h > 0)) [w, h] = [SIDE, SIDE];
    else [w, h] = [w * (SIDE / Math.max(w, h)), h * (SIDE / Math.max(w, h))]; // 小さく書いた SVG も、長い辺 1254 で描く
    return toJpeg(img, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 選んだ絵を、長い辺 1254 までの jpeg にする(撮った場所などの付いた情報は、描き直すので残らない) */
async function encode(file) {
  if (isSvg(file)) return svgPicture(file);
  const bmp = await createImageBitmap(file);
  try {
    return toJpeg(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close?.();
  }
}

async function sendMake(body, told) {
  if (S.busy) return;
  S.busy = true;
  error("");
  try {
    const r = await api("/api/review/make", { method: "POST", body: { ...body, role: ROLE, ...(PLACE ? { place: PLACE } : {}) } });
    Object.assign(S, { id: r.id, drawn: 0, ticket: null, hash: null, check: null, checkTold: false, seenAt: 0, lastAct: null });
    $("words").value = ""; // 送った言葉の下書きは残さない(次の子の欄に前の言葉が残っていた。低 15)
    updateWords();
    show("waiting");
    $("activity").textContent = "";
    tell("sent", told);
  } catch (e) {
    error(e.message);
  } finally {
    S.busy = false;
  }
}

// ---------- 1 歩目: 言葉か絵 ----------
function updateWords() {
  const n = chars($("words").value.trim());
  $("wordsCount").textContent = `${n} / ${S.wordsMax}`;
  $("wordsCount").classList.toggle("over", n > S.wordsMax);
  $("wordsBtn").disabled = n === 0 || n > S.wordsMax;
}
$("words").addEventListener("input", () => {
  error(""); // 新しく書き始めたら、前の赤い断りの文は消す(低 15)
  updateWords();
});
$("wordsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const words = $("words").value.trim();
  if (!words || chars(words) > S.wordsMax) return;
  S.auto = false;
  sendMake({ from: "words", words }, { from: "words", words });
});
// おまかせ(ぜんぶ じどう): おまかせの言葉で作り、この後の選びも全部おすすめで決める(あとから直せる)
$("autoStart").addEventListener("click", () => {
  Object.assign(S, { auto: true, autoBrow: false });
  sendMake({ from: "words", words: OMAKASE_WORDS }, { from: "words", words: OMAKASE_WORDS, auto: true });
});
for (const id of ["photo", "pick"]) {
  $(id).addEventListener("change", async () => {
    const f = $(id).files?.[0];
    $(id).value = "";
    if (!f) return;
    if (!(/^image\//.test(f.type) || isSvg(f)) || f.size > 20 * 1024 * 1024) return error(`${FORMATS} の絵(20MB まで)を選んでください`);
    let picture;
    try {
      picture = await encode(f);
    } catch {
      return error(`この絵は読めませんでした。${FORMATS} の絵にしてください`);
    }
    sendMake({ from: "picture", picture }, { from: "picture", kind: id });
  });
}

// ---------- 2 歩目: ゆるキャラチェックの後の選び ----------
$("chooseBtn").addEventListener("click", () => choose());
$("autoCheck").addEventListener("click", () => {
  S.auto = true;
  choose();
});
async function choose() {
  if (S.busy || !S.check) return;
  const choice = S.check.class === "human" ? "yurufy" : "redraw";
  S.busy = true;
  try {
    await api("/api/review/make/choice", { method: "POST", body: { choice } });
    show("waiting");
    tell("chose", { choice });
  } catch (e) {
    error(e.message);
  } finally {
    S.busy = false;
  }
}
const restart = () => {
  S.id = null;
  Object.assign(S, { auto: false, autoBrow: false, look: null });
  $("words").value = "";
  updateWords();
  show("input");
  tell("restart");
};
$("otherBtn").addEventListener("click", restart);
$("againBtn").addEventListener("click", restart);

// ---------- 3 歩目: C0 の絵 ----------
async function decide(decision, note) {
  if (S.busy || !S.ticket) return;
  S.busy = true;
  error("");
  try {
    await api("/api/review/decision", { method: "POST", body: { gate: "C0", decision, ticket: S.ticket, seen_hash: S.hash, note: note || null, tags: [], focus: null } });
    const auto = S.auto ? { auto: true } : {};
    if (decision === "ok") {
      $("doneMsg").textContent = `${S.name}にきまりました。あたらしい子は、パソコンの Claude Code で つくれるよ(3D は約 20 分。この画面からは まだ はじまらないよ)。`
        + (S.auto ? "おまかせで きめました。あとから「直したい」で いつでも 直せます。" : "");
      $("donePic").src = $("pic").src; // 決めた絵は、決めた後も見せる
      show("done");
      tell("decided", { decision: "ok", id: S.id, name: S.name, round: S.drawn, ...auto });
      // スマホだけで作る時(会話の画面の枠の外で開いた時): この画面の中で 2D の知らせと「3D にもする?」を出す(B4 12b)
      if (!PARENT || window.parent === window) phoneAfterOk();
    } else {
      $("note").value = "";
      updateNote();
      S.ticket = null;
      S.seenAt = 0;
      show("waiting");
      $("activity").textContent = "";
      tell("decided", { decision: "redo", note, round: S.drawn, ...auto });
    }
  } catch (e) {
    error(e.reason === "changed" ? "絵が新しくなっています。見直してから、もう一度押してください" : e.message);
  } finally {
    S.busy = false;
  }
}
$("okBtn").addEventListener("click", () => decide("ok"));
/** おまかせの決め方: 眉の無い絵なら 1 回だけ眉を足す(ふつう)。ほかは OK */
function autoDecide() {
  if (wantBrow(S.look, S.id) && !S.autoBrow && !overLimit()) {
    S.autoBrow = true;
    return decide("redo", BROW_AUTO.note);
  }
  return decide("ok");
}
$("autoPick").addEventListener("click", () => {
  S.auto = true;
  autoDecide();
});
function updateNote() {
  const n = chars($("note").value.trim());
  $("noteCount").textContent = `${n} / ${S.noteMax}`;
  $("noteCount").classList.toggle("over", n > S.noteMax);
  $("noteBtn").disabled = n === 0 || n > S.noteMax;
}
$("note").addEventListener("input", () => {
  error("");
  updateNote();
});
$("noteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const note = $("note").value.trim();
  if (!note || chars(note) > S.noteMax) return;
  decide("redo", note);
});

async function showDrawn(st) {
  const g = st.gates.C0;
  const b = await api(`/api/review/bundle/C0?round=${g.round}`);
  const m = b.manifest;
  const file = m.png || m.compare.right;
  const blob = await api(`/api/review/file/C0/r${g.round}/${file}`, { blob: true });
  if (S.picUrl) URL.revokeObjectURL(S.picUrl);
  S.picUrl = URL.createObjectURL(blob);
  Object.assign(S, { drawn: g.round, ticket: g.ticket, shownTicket: g.ticket, hash: b.hash, name: st.name && st.name !== "新しい子" ? st.name : "新しい子" });
  $("pic").src = S.picUrl;
  // 画面に内部の言葉(C0・段 0)を出さない(D7)
  // 試験の絵(--fake-draw)は、Claude を呼んでいないので、Claude Code が描いたとは言わない(CRITux3 低 1)
  const fake = (m.metrics || []).some((x) => x.key === "fake");
  $("picCap").textContent = fake ? `${S.name}(${g.round} 回目の試しの絵です。Claude は呼んでいません)` : `${S.name}(${g.round} 回目の絵。この PC の Claude Code が描きました)`;
  // 描き直しで、頼んでいない所も変わった時は、その事を正直に出す(PC の決まった確かめ redo_check.py が書いた一言。N-0026)
  // (門の一言は「前の判断は受け取れませんでした」にも使うので、描き直しの一言の形の時だけ出す)
  const drift = g.round > 1 && /^頼んでいない所/.test(String(g.notice || "")) ? String(g.notice) : "";
  S.drift = drift;
  $("drift").textContent = drift;
  $("note").value = ""; // 前の絵への頼みの下書きは、新しい絵に持ちこさない(低 15)
  updateNote();
  // 直しは 3 回まで(4 枚目の絵の後は「この子にする」か「別の子にする」だけ。画面と PC が互いを待たない。CRITux3 D1)
  // 4 枚目の絵の後は、一言の欄と送るを消さずに灰色にして押せなくする(確かめる画面 /r/ と同じ。低 15)
  const over = overLimit();
  $("noteForm").classList.toggle("mk-off", over);
  $("note").disabled = over;
  $("noteBtn").disabled = over || $("noteBtn").disabled;
  for (const b of $("quick").querySelectorAll("button")) b.disabled = over;
  $("limit").hidden = !over;
  S.look = b.look || null;
  const noBrows = renderBrow();
  show("c0");
  tell("drawn", { id: S.id, name: S.name, round: g.round, ...(drift ? { drift: drift.slice(0, 120) } : {}), ...(noBrows ? { noBrows: true } : {}) });
  if (S.auto) autoDecide();
}

/** 眉のおすすめの札(「この子にする」の上)。出したら true */
function renderBrow() {
  const slot = $("browSlot");
  slot.replaceChildren();
  const want = wantBrow(S.look, S.id) && !S.auto && !overLimit();
  if (want) slot.append(browCard({ id: S.id, onPick: (c) => decide("redo", c.note), onNo: () => { slot.hidden = true; } }));
  slot.hidden = !want;
  return want;
}

// ---------- 様子を見る ----------
async function poll() {
  if (!S.id || !["waiting", "check"].includes(S.phase)) return;
  const j = await api("/api/review/state");
  const st = j.state;
  if (!st || st.id !== S.id) return;
  S.wordsMax = j.words_max || S.wordsMax;
  S.noteMax = j.note_max || S.noteMax;
  S.redoMax = j.redo_max ?? S.redoMax;
  const mk = st.make || {};
  // この PC が自分で /yuru-next を流す時(--auto-next)は、「/yuru-next と打つ」を出さない(スマホだけで作れる。B4 12b)
  if (j.server?.auto?.on) $("waitHint").textContent = j.server.auto.busy ? "パソコンが うごいているよ。少し まってね。" : "パソコンが 自分で すすめるよ。";
  // ゆるキャラチェックの結果は、PC の様子(「絵を描いています」など)より先に知らせる。チェックと絵が 1 回の /yuru-next で
  // 続けて流れると、1 回の見回りで両方が見え、札に「絵を描いています」が「この絵から作るよ」より先に出ていた(CRITux2 低 11)
  if (mk.check && !S.checkTold) {
    S.checkTold = true;
    S.check = mk.check;
    tell("checked", { class: mk.check.class, message: (mk.check.message || "").slice(0, 120), by: mk.check.by });
  }
  const act = st.current && st.current.activity;
  if (act && act !== S.lastAct) {
    S.lastAct = act;
    $("activity").textContent = act;
    tell("progress", { text: act.slice(0, 120) });
  }
  if (mk.status === "failed") {
    error(mk.notice || "パソコンで えがけなかったよ。もう一度 やってみてね");
    return;
  }
  if (S.phase === "waiting" && mk.status === "check_waiting" && !j.make?.choice) {
    $("checkMsg").textContent = mk.check.message;
    $("chooseBtn").textContent = mk.check.class === "human" ? "ゆるキャラにしてみる" : "主役を描き直してもらう";
    show("check");
    if (S.auto) choose();
    return;
  }
  const g = st.gates.C0;
  // 新しい絵、または同じ絵の確認が出し直された時(直しの上限を超えて、PC が「この子にする」か「別の子にする」を出し直した時)
  if (S.phase === "waiting" && g.status === "waiting" && (g.round > S.drawn || (g.ticket && g.ticket !== S.shownTicket))) {
    S.seenAt ||= Date.now();
    // PC が名前を書き終える(make が drawn)まで少し待つ(8 秒まで)
    if (mk.status !== "drawing" || Date.now() - S.seenAt > 8000) await showDrawn(st);
  }
}

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await poll();
      if (S.pollErr) {
        S.pollErr = false;
        error("");
      }
    } catch (e) {
      S.pollErr = true;
      error(e.message);
    }
    schedule();
  }, document.hidden ? 5000 : 1200);
}

/** 絵だけの枠: いまの子の最後に描いた絵を出す(枠を作った後に描き直されても、5 秒ごとに新しい回を見る) */
async function picOnly() {
  document.documentElement.classList.add("mk-pic");
  show("done");
  $("doneMsg").textContent = "";
  let shown = 0;
  const tick = async () => {
    try {
      const j = await api("/api/review/state");
      const g = j.state && j.state.gates && j.state.gates.C0;
      // 動く 2D ができた(パソコンが組んだ)ら、会話の画面へ 1 回だけ知らせる(舞台に出す。B4 12b)
      if (j.state?.make?.twod === "ready" && !S.twodTold) {
        S.twodTold = true;
        tell("twod", { id: j.state.id });
      }
      if (g && g.round > shown) {
        const b = await api(`/api/review/bundle/C0?round=${g.round}`);
        const m = b.manifest;
        const blob = await api(`/api/review/file/C0/r${g.round}/${m.png || m.compare.right}`, { blob: true });
        if (S.picUrl) URL.revokeObjectURL(S.picUrl);
        S.picUrl = URL.createObjectURL(blob);
        $("donePic").src = S.picUrl;
        shown = g.round;
      }
      error("");
    } catch (e) {
      error(e.message);
    }
    setTimeout(tick, S.twodTold ? 5000 : 1500);
  };
  tick();
}

/**
 * スマホだけで作る時の続き(会話の画面の枠の外): パソコンが 2D を組んだら知らせ、「3D にもする?」→ 形 → しつかん → 変換の絵(B4 12b)。
 * 選ぶ札は見本の絵つき。選んだ物は、この PC のサーバーへ(会話の画面の札と同じ頼み)
 */
function phoneAfterOk() {
  const box = $("phone3d");
  const msg = $("p3Msg");
  const pick = $("p3Choices");
  const btn = (label, onClick, { img = null, primary = false } = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `mk-btn${primary ? " primary" : ""}${img ? " mk-card" : ""}`;
    if (img) {
      const i = document.createElement("img");
      i.src = img;
      i.alt = "";
      b.append(i);
    }
    b.append(document.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  };
  const choose = (list, onPick, auto) => {
    pick.replaceChildren(...list.map((x, k) => btn(x.label, () => onPick(x.id), { img: x.img, primary: k === 0 })), btn("おまかせ", auto));
  };
  const askShape = () => {
    box.hidden = false;
    msg.textContent = "どんな かたちに する?(3D は、ゆるキャラの かたちに ととのえて つくるよ)";
    choose(SHAPES, (shape) => askMaterial(shape), () => go({ shape: "atama", material: "fabric" }));
  };
  const askMaterial = (shape) => {
    msg.textContent = "さわった かんじ(しつかん)は?";
    choose(MATERIALS, (material) => go({ shape, material }), () => go({ shape, material: "fabric" }));
  };
  const go = (c) => {
    box.hidden = true;
    convertView({ ...c, cid: S.id }, { onAgain: () => { show("done"); askShape(); }, onDone: () => { $("doneMsg").textContent = "3D は パソコンで つくるよ(やく 20 ぷん)。それまで 2D で 話せるよ。"; } });
  };
  const tick = async () => {
    try {
      const j = await api("/api/review/state");
      if (j.state?.make?.twod === "ready") {
        $("doneMsg").textContent = `${S.name}を うごく 2D に したよ。パソコンの 舞台に 出ているよ。`;
        box.hidden = false;
        msg.textContent = "3D にもする?(やく 20 ぷん)";
        pick.replaceChildren(btn("3D にも する", askShape, { primary: true }), btn("いまは 2D だけ", () => { box.hidden = true; }));
        return;
      }
      if (j.state?.make?.twod === "failed") {
        $("doneMsg").textContent = "2D に できなかったよ。3D は パソコンで つくれるよ。";
        return;
      }
    } catch (e) {
      error(e.message);
    }
    setTimeout(tick, 1500);
  };
  $("doneMsg").textContent = `${S.name}に きまったよ。いま、うごく 2D に しているよ。`;
  tick();
}

/** 変換の絵の枠: 形と しつかんを PC に渡し、描けたら絵と「この かたちで 3D に する」「ちがう かたちに する」を出す(B4 12b) */
async function convertView(c = CONVERT, { onAgain = null, onDone = null } = {}) {
  show("convert");
  $("convFig").hidden = true;
  $("convOk").hidden = true;
  $("convAgain").hidden = true;
  $("convOk").disabled = false;
  const act = $("convAct");
  let rnd = 0;
  let told = false;
  try {
    const r = await api("/api/review/make/convert", { method: "POST", body: { shape: c.shape, material: c.material } });
    rnd = r.round;
    act.textContent = "パソコンに たのんだよ。描けるまで 少し まってね。";
  } catch (e) {
    error(e.message);
    $("convAgain").hidden = false;
    return;
  }
  $("convOk").onclick = async () => {
    $("convOk").disabled = true;
    try {
      await api("/api/review/make/convert_ok", { method: "POST", body: { round: rnd } });
      act.textContent = "この かたちで 3D に するね。パソコンで つくるよ(やく 20 ぷん)。";
      $("convOk").hidden = true;
      $("convAgain").hidden = true;
      tell("converted", { id: c.cid });
      onDone?.();
    } catch (e) {
      $("convOk").disabled = false;
      error(e.message);
    }
  };
  $("convAgain").onclick = () => (onAgain ? onAgain() : tell("converted", { id: c.cid, again: true }));
  const tick = async () => {
    try {
      const j = await api("/api/review/state");
      const cv = j.state?.make?.convert || {};
      const a = j.state?.current?.activity;
      if (a && !told) act.textContent = a;
      if (cv.round === rnd && cv.status === "drawn" && !told) {
        told = true;
        const blob = await api(`/api/review/convert/r${rnd}/drawing.png`, { blob: true });
        if (S.picUrl) URL.revokeObjectURL(S.picUrl);
        S.picUrl = URL.createObjectURL(blob);
        $("convPic").src = S.picUrl;
        $("convFig").hidden = false;
        $("convOk").hidden = false;
        $("convAgain").hidden = false;
        act.textContent = "この かたちで いい?";
        return;
      }
      if (cv.round === rnd && cv.status === "failed") {
        error("かたちの 絵を 描けなかったよ。もう一度 えらんでね");
        $("convAgain").hidden = false;
        return;
      }
      error("");
    } catch (e) {
      error(e.message);
    }
    setTimeout(tick, 1500);
  };
  tick();
}

(async () => {
  if (PIC_ONLY && KEY) return picOnly();
  if (CONVERT && KEY) return convertView();
  if (!KEY) {
    error("あいことばが ないよ。パソコンの 画面の リンクから ひらき直してね");
    show("input");
    $("wordsBtn").disabled = true;
    return;
  }
  updateWords();
  updateNote();
  $("quick").append(quickChips({ input: $("note"), onFill: updateNote, cls: "mk-chips" }));
  try {
    const j = await api("/api/review/state");
    S.wordsMax = j.words_max || 60;
    S.noteMax = j.note_max || 40;
    S.redoMax = j.redo_max ?? S.redoMax;
    $("wordsMax").textContent = String(S.wordsMax);
    $("noteMax").textContent = String(S.noteMax);
  } catch (e) {
    error(e.message);
  }
  updateWords();
  updateNote();
  show("input");
  tell("ready");
  schedule();
})();
