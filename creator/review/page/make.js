// 作る画面(初めての会話の 1〜3 歩の中に、枠で出す)。この PC のサーバー(serve_review.py --make)が配る。
// 言葉か絵 1 枚をこの PC の作る道へ渡し、ゆるキャラチェック → 段 0 の絵(C0)→「この子にする」/「直したい(一言)」/「やり直す」を、
// この画面の中だけで扱う。親の画面(会話の画面)には、状態の知らせ(postMessage)だけを送る。絵・合言葉は親に送らない。
// - 合言葉は枠の URL の # の後ろ(k=)で受け、見出し X-YC-Key で送る(枠の中は Cookie が使えない)。読んだら # を消す。
// - データから来る文字は全部 textContent で入れる。
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const KEY = params.get("k") || "";
// view=pic: 「この子にする」の後、会話の画面の札の上に小さく出す枠。描いた絵だけを見せる(ボタン・知らせなし。D5)
const PIC_ONLY = params.get("view") === "pic";
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
  wordsMax: 60, noteMax: 40, name: "", picUrl: null };
const SIDE = 1254;
const chars = (s) => [...String(s ?? "")].length;

/** 親の画面へ、状態の知らせだけを送る(決めた欄だけ。絵・合言葉は入れない) */
function tell(ev, data = {}) {
  if (PARENT && window.parent !== window) window.parent.postMessage({ src: "yc-make", ev, ...data }, PARENT);
}

async function api(path, { method = "GET", body = null, blob = false } = {}) {
  const headers = { "X-YC-Key": KEY };
  if (body) Object.assign(headers, { "Content-Type": "application/json", "X-YC": "1" });
  let r;
  try {
    r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "omit" });
  } catch {
    throw new Error("PC につながりません(serve_review.py --make が動いているか確かめてください)");
  }
  if (blob && r.ok) return r.blob();
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `PC が断りました(${r.status})`), { reason: j.reason });
  return j;
}

function show(phase) {
  S.phase = phase;
  $("mk").dataset.phase = phase;
  for (const p of ["input", "waiting", "check", "c0", "done"]) $(p).hidden = p !== phase;
}

function error(msg) {
  $("err").textContent = msg || "";
  $("err").hidden = !msg;
  if (msg) tell("error", { message: String(msg).slice(0, 120) });
}

/** 選んだ絵を、長い辺 1254 までの jpeg にする(撮った場所などの付いた情報は、描き直すので残らない) */
async function encode(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL("image/jpeg", 0.9);
}

async function sendMake(body, told) {
  if (S.busy) return;
  S.busy = true;
  error("");
  try {
    const r = await api("/api/review/make", { method: "POST", body });
    Object.assign(S, { id: r.id, drawn: 0, ticket: null, hash: null, check: null, checkTold: false, seenAt: 0, lastAct: null });
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
$("words").addEventListener("input", updateWords);
$("wordsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const words = $("words").value.trim();
  if (!words || chars(words) > S.wordsMax) return;
  sendMake({ from: "words", words }, { from: "words", words });
});
for (const id of ["photo", "pick"]) {
  $(id).addEventListener("change", async () => {
    const f = $(id).files?.[0];
    $(id).value = "";
    if (!f) return;
    if (!/^image\//.test(f.type) || f.size > 20 * 1024 * 1024) return error("画像(20MB まで)を選んでください");
    let picture;
    try {
      picture = await encode(f);
    } catch {
      return error("この絵は読めませんでした。別の絵にしてください");
    }
    sendMake({ from: "picture", picture }, { from: "picture", kind: id });
  });
}

// ---------- 2 歩目: ゆるキャラチェックの後の選び ----------
$("chooseBtn").addEventListener("click", async () => {
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
});
const restart = () => {
  S.id = null;
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
    if (decision === "ok") {
      $("doneMsg").textContent = `${S.name}にきまりました。形(3D)は PC の Claude Code が続けて作ります。`;
      $("donePic").src = $("pic").src; // 決めた絵は、決めた後も見せる
      show("done");
      tell("decided", { decision: "ok", id: S.id, name: S.name, round: S.drawn });
    } else {
      $("note").value = "";
      updateNote();
      S.ticket = null;
      S.seenAt = 0;
      show("waiting");
      $("activity").textContent = "";
      tell("decided", { decision: "redo", note, round: S.drawn });
    }
  } catch (e) {
    error(e.reason === "changed" ? "絵が新しくなっています。見直してから、もう一度押してください" : e.message);
  } finally {
    S.busy = false;
  }
}
$("okBtn").addEventListener("click", () => decide("ok"));
function updateNote() {
  const n = chars($("note").value.trim());
  $("noteCount").textContent = `${n} / ${S.noteMax}`;
  $("noteCount").classList.toggle("over", n > S.noteMax);
  $("noteBtn").disabled = n === 0 || n > S.noteMax;
}
$("note").addEventListener("input", updateNote);
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
  Object.assign(S, { drawn: g.round, ticket: g.ticket, hash: b.hash, name: st.name && st.name !== "新しい子" ? st.name : "新しい子" });
  $("pic").src = S.picUrl;
  // 画面に内部の言葉(C0・段 0)を出さない(D7)
  $("picCap").textContent = `${S.name}(${g.round} 回目の絵。この PC の Claude Code が描きました)`;
  show("c0");
  tell("drawn", { id: S.id, name: S.name, round: g.round });
}

// ---------- 様子を見る ----------
async function poll() {
  if (!S.id || !["waiting", "check"].includes(S.phase)) return;
  const j = await api("/api/review/state");
  const st = j.state;
  if (!st || st.id !== S.id) return;
  S.wordsMax = j.words_max || S.wordsMax;
  S.noteMax = j.note_max || S.noteMax;
  const act = st.current && st.current.activity;
  if (act && act !== S.lastAct) {
    S.lastAct = act;
    $("activity").textContent = act;
    tell("progress", { text: act.slice(0, 120) });
  }
  const mk = st.make || {};
  if (mk.status === "failed") {
    error(mk.notice || "PC で描けませんでした。もう一度 /yuru-next と打ってください");
    return;
  }
  if (mk.check && !S.checkTold) {
    S.checkTold = true;
    S.check = mk.check;
    tell("checked", { class: mk.check.class, message: (mk.check.message || "").slice(0, 120), by: mk.check.by });
  }
  if (S.phase === "waiting" && mk.status === "check_waiting" && !j.make?.choice) {
    $("checkMsg").textContent = mk.check.message;
    $("chooseBtn").textContent = mk.check.class === "human" ? "ゆるキャラにしてみる" : "主役を描き直してもらう";
    show("check");
    return;
  }
  const g = st.gates.C0;
  if (S.phase === "waiting" && g.status === "waiting" && g.round > S.drawn) {
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
    setTimeout(tick, 5000);
  };
  tick();
}

(async () => {
  if (PIC_ONLY && KEY) return picOnly();
  if (!KEY) {
    error("合言葉がありません。PC の /qr の画面のリンクから開き直してください");
    show("input");
    $("wordsBtn").disabled = true;
    return;
  }
  updateWords();
  updateNote();
  try {
    const j = await api("/api/review/state");
    S.wordsMax = j.words_max || 60;
    S.noteMax = j.note_max || 40;
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
