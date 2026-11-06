// 確かめる画面(C0 絵・C2 形)。状態は PC のファイルが正で、この画面は何も持たない。
// データから来る文字は全部 textContent で入れる(HTML として入れない)。
const $ = (id) => document.getElementById(id);
const NAME_RE = /^[a-z0-9_]{1,48}\.(png|jpg|svg|json)$/;
const GATE_LABEL = { C0: "絵", C2: "形", C3: "色", C5: "話す" };
const STEP_SHORT = ["絵", "読む", "形", "色", "模様", "骨", "動き", "話す"];
const SHOWN_GATES = ["C0", "C2", "C3", "C5"];
const READY_GATES = ["C0", "C2"]; // 今夜、画面があるのはこの 2 つ
const GATE_OF_STEP = { 0: "C0", 2: "C2", 3: "C3", 4: "C3", 7: "C5" };
const MARK = { todo: "", running: "…", waiting: "●", done: "✓", auto: "✓", failed: "!", stale: "~" };

const app = {
  state: null, pending: null, server: null, tags: {}, noteMax: 40, etag: null, fails: 0,
  gate: null, bundles: {}, focus: null, cut: 50, armedUntil: 0, sending: false, error: null,
};

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("data-") || k.startsWith("aria-") || ["type", "role", "id", "alt", "for"].includes(k)) e.setAttribute(k, v);
    else e[k] = v;
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

function fileUrl(gate, round, name) {
  if (!NAME_RE.test(name || "")) return "";
  return `/api/review/file/${gate}/r${round}/${name}`;
}

const chars = (s) => [...s].length;

// ---------- 読む ----------
async function poll() {
  try {
    const headers = app.etag ? { "If-None-Match": app.etag } : {};
    const res = await fetch("/api/review/state", { headers, credentials: "same-origin", cache: "no-store" });
    if (res.status === 304) { app.fails = 0; return; }
    if (res.status === 401) { showConn("合言葉の入口(QR)から開き直してください"); return; }
    if (!res.ok) throw new Error(String(res.status));
    app.etag = res.headers.get("ETag");
    const data = await res.json();
    app.fails = 0;
    app.state = data.state; app.pending = data.pending; app.server = data.server;
    app.tags = data.tags || {}; app.noteMax = data.note_max || 40;
    const turn = pickGate();
    const cur = app.gate && app.state.gates[app.gate];
    if (!cur || !READY_GATES.includes(app.gate) || (cur.status !== "waiting" && app.state.gates[turn].status === "waiting")) app.gate = turn;
    await ensureBundle(app.gate);
    render();
  } catch (e) {
    app.fails += 1;
    if (app.fails >= 3) showConn("PC につながりません");
  } finally {
    $("conn").hidden = app.fails < 3 && $("conn").dataset.forced !== "1";
  }
}

function showConn(msg) {
  $("conn").textContent = msg;
  $("conn").dataset.forced = "1";
  $("conn").hidden = false;
}

function pickGate() {
  const g = app.state.gates;
  const turn = READY_GATES.find((k) => g[k].status === "waiting");
  if (turn) return turn;
  const shown = READY_GATES.filter((k) => g[k].round > 0);
  return shown.length ? shown[shown.length - 1] : "C0";
}

async function ensureBundle(gate) {
  const g = app.state.gates[gate];
  if (!g || g.round < 1) return null;
  const key = `${gate}/${g.round}`;
  if (app.bundles[key]) return app.bundles[key];
  const res = await fetch(`/api/review/bundle/${gate}?round=${g.round}`, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  app.bundles[key] = data;
  if (app.gate === gate) app.focus = data.manifest.compare.right;
  return data;
}

// ---------- 描く ----------
function render() {
  const st = app.state;
  if (!st) return;
  $("name").textContent = st.name;
  document.title = `${st.name} を確かめる`;
  renderSteps(st);
  const act = st.current && st.current.activity;
  $("activity").hidden = !act;
  $("activity").textContent = act || "";
  renderGates(st);
  renderView();
  renderBar();
}

function renderSteps(st) {
  const ol = $("steps");
  ol.replaceChildren();
  for (const s of st.stages) {
    const li = el("li", { class: "step" + (GATE_OF_STEP[s.n] ? " gate" : ""), "data-s": s.status });
    li.append(el("span", { class: "dot", "aria-hidden": "true" }, MARK[s.status] || ""));
    li.append(el("span", { class: "step-label" }, STEP_SHORT[s.n] || s.label));
    li.title = `${s.n} ${s.label}: ${s.status}`;
    ol.append(li);
  }
}

function renderGates(st) {
  const nav = $("gates");
  nav.replaceChildren();
  for (const g of SHOWN_GATES) {
    const info = st.gates[g];
    const ready = READY_GATES.includes(g) && info.round > 0;
    const mark = info.status === "ok" ? " ✓" : info.status === "waiting" ? " ●" : "";
    const b = el("button", { type: "button", class: "gate-tab", role: "tab", "aria-selected": String(app.gate === g), "data-turn": info.status === "waiting" ? "1" : "0" },
      `${GATE_LABEL[g]}${mark}`); // 画面に内部の言葉(C0 など)を出さない(D7)
    b.disabled = !ready;
    if (!READY_GATES.includes(g)) b.title = "準備中";
    b.addEventListener("click", async () => { app.gate = g; app.error = null; await ensureBundle(g); render(); });
    nav.append(b);
  }
}

function currentBundle() {
  const g = app.state.gates[app.gate];
  return g && g.round > 0 ? app.bundles[`${app.gate}/${g.round}`] : null;
}

function renderView() {
  const view = $("view");
  const g = app.state.gates[app.gate];
  const notice = g && g.notice;
  $("notice").hidden = !notice;
  $("notice").textContent = notice || "";
  view.replaceChildren();
  const b = currentBundle();
  if (!b) {
    view.append(el("div", { class: "card" }, "まだ見せる物がありません。PC で作っている途中です。"));
    return;
  }
  const m = b.manifest;
  if (app.gate === "C0") renderC0(view, m);
  else renderC2(view, m);
}

function renderC0(view, m) {
  if (m.words) {
    const c = el("div", { class: "card" });
    c.append(el("p", { class: "words-label" }, "もとの言葉"), el("p", { class: "words" }, `「${m.words}」`));
    view.append(c);
  }
  const c = el("div", { class: "card" });
  c.append(el("h2", {}, `Claude が描いた絵(${m.round} 回目)`));
  if (m.compare.left) c.append(compareBox(m, "元の絵", "描いた絵"));
  else {
    const img = el("img", { class: "single", alt: "Claude が描いた絵" });
    img.src = fileUrl(m.gate, m.round, m.compare.right);
    c.append(img);
  }
  c.append(el("p", { class: "meta" }, "形がかわいいか、言葉に合っているかを見てください。"));
  view.append(c);
  if (m.metrics.length) view.append(metricsCard(m));
}

function renderC2(view, m) {
  const c = el("div", { class: "card" });
  c.append(el("h2", {}, `形(${m.round} 回目)`));
  const rightLabel = app.focus === m.compare.right ? "作った物" : (m.views.find((v) => v.file === app.focus) || {}).label || "作った物";
  if (m.compare.left) c.append(compareBox(m, "元の絵", rightLabel));
  else {
    const img = el("img", { class: "single", alt: rightLabel });
    img.src = fileUrl(m.gate, m.round, app.focus || m.compare.right);
    c.append(img);
  }
  if (m.metrics.length) c.append(metricsList(m));
  view.append(c);
  if (m.views.length) {
    const v = el("div", { class: "card" });
    v.append(el("h2", {}, "8 方向(押すと上に出ます)"));
    const grid = el("div", { class: "views" });
    for (const item of m.views) {
      const btn = el("button", { type: "button", class: "view-btn", "aria-pressed": String(app.focus === item.file) });
      const img = el("img", { alt: item.label, loading: "lazy" });
      img.src = fileUrl(m.gate, m.round, item.file);
      btn.append(img, el("span", {}, item.label));
      btn.addEventListener("click", () => { app.focus = item.file; app.cut = item.deg === 0 ? 50 : 96; renderView(); });
      grid.append(btn);
    }
    v.append(grid);
    view.append(v);
  } else if (m.sheet) {
    const v = el("div", { class: "card" });
    v.append(el("h2", {}, "8 方向"));
    const img = el("img", { class: "sheet-img", alt: "8 方向の一覧" });
    img.src = fileUrl(m.gate, m.round, m.sheet);
    v.append(img);
    view.append(v);
  }
  if (m.overlay) {
    const v = el("div", { class: "card" });
    const btn = el("button", { type: "button", class: "btn small" }, "輪郭の重なりを見る");
    const img = el("img", { class: "sheet-img", alt: "輪郭の重なり" });
    img.hidden = true;
    btn.addEventListener("click", () => {
      if (!img.src) img.src = fileUrl(m.gate, m.round, m.overlay);
      img.hidden = !img.hidden;
      btn.textContent = img.hidden ? "輪郭の重なりを見る" : "輪郭の重なりを閉じる";
    });
    v.append(btn, img);
    view.append(v);
  }
}

function metricsList(m) {
  const ul = el("ul", { class: "metrics" });
  for (const x of m.metrics) ul.append(el("li", {}, `${x.label} ${x.value}`));
  return ul;
}

function metricsCard(m) {
  const c = el("div", { class: "card" });
  c.append(el("h2", {}, "機械の検査"), metricsList(m));
  return c;
}

function compareBox(m, leftLabel, rightLabel) {
  const wrap = el("div");
  const box = el("div", { class: "compare", role: "img", "aria-label": `${leftLabel}と${rightLabel}の比べ` });
  const left = el("img", { alt: "" });
  left.src = fileUrl(m.gate, m.round, m.compare.left);
  const right = el("img", { class: "top-img", alt: "" });
  right.src = fileUrl(m.gate, m.round, app.focus && app.gate === m.gate ? app.focus : m.compare.right);
  const handle = el("div", { class: "handle" });
  box.append(left, right, handle, el("span", { class: "tag-l" }, leftLabel), el("span", { class: "tag-r" }, rightLabel));
  box.style.setProperty("--cut", `${app.cut}%`);
  const range = el("input", { type: "range", "aria-label": "仕切りの位置" });
  range.min = "0"; range.max = "100"; range.value = String(app.cut);
  const setCut = (v) => {
    app.cut = Math.max(0, Math.min(100, v));
    box.style.setProperty("--cut", `${app.cut}%`);
    range.value = String(Math.round(app.cut));
  };
  let drag = false;
  const fromEvent = (e) => {
    const r = box.getBoundingClientRect();
    setCut(((e.clientX - r.left) / r.width) * 100);
  };
  box.addEventListener("pointerdown", (e) => { drag = true; box.setPointerCapture(e.pointerId); fromEvent(e); });
  box.addEventListener("pointermove", (e) => { if (drag) fromEvent(e); });
  box.addEventListener("pointerup", () => { drag = false; });
  box.addEventListener("pointercancel", () => { drag = false; });
  range.addEventListener("input", () => setCut(Number(range.value)));
  wrap.append(box, range);
  return wrap;
}

// ---------- 下の帯 ----------
function barReason() {
  const g = app.state.gates[app.gate];
  if (!app.server || !app.server.can_write) return "見るだけです(QR の入口から開くと押せます)";
  if (app.pending) return null;
  if (!g || g.status !== "waiting") {
    const turn = READY_GATES.find((k) => app.state.gates[k].status === "waiting");
    if (g && g.status === "ok") return turn ? `この確認は OK 済みです(いまは ${turn} の番)` : "この確認は OK 済みです";
    return "作っている途中です";
  }
  return null;
}

function renderBar() {
  const reason = barReason();
  const msg = $("barMsg");
  if (app.error) { msg.textContent = app.error; msg.className = "bar-msg err"; msg.hidden = false; }
  else if (reason) { msg.textContent = reason; msg.className = "bar-msg"; msg.hidden = false; }
  else msg.hidden = true;
  const waitingMine = !!app.pending;
  $("pending").hidden = !waitingMine;
  $("buttons").hidden = waitingMine;
  if (waitingMine) {
    $("pendingText").textContent = `PC の受け取りを待っています…(${GATE_LABEL[app.pending.gate] || ""} ${app.pending.decision === "ok" ? "OK" : "やり直し"})`;
  }
  const can = !reason && !app.sending;
  $("okBtn").disabled = !can;
  $("redoBtn").disabled = !can;
  const armed = Date.now() < app.armedUntil;
  $("okBtn").classList.toggle("armed", armed);
  $("okBtn").textContent = armed ? `${GATE_LABEL[app.gate]}を OK にする(もう一度)` : "OK";
}

async function send(decision, note, tags) {
  const g = app.state.gates[app.gate];
  const b = currentBundle();
  if (!b) return false;
  app.sending = true; app.error = null; renderBar();
  try {
    const res = await fetch("/api/review/decision", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-YC": "1" },
      body: JSON.stringify({ gate: app.gate, ticket: g.ticket, decision, seen_hash: b.hash, note: note || null, tags: tags || [], focus: app.focus }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      app.error = data.error || "送れませんでした";
      if (data.reason === "changed") { app.bundles = {}; }
      app.etag = null;
      return false;
    }
    app.etag = null;
    return true;
  } catch (e) {
    app.error = "PC につながりません";
    return false;
  } finally {
    app.sending = false;
    await poll();
    renderBar();
  }
}

$("okBtn").addEventListener("click", async () => {
  if (Date.now() < app.armedUntil) {
    app.armedUntil = 0;
    await send("ok", null, []);
    return;
  }
  app.armedUntil = Date.now() + 3000;
  renderBar();
  setTimeout(renderBar, 3100);
});

$("cancelBtn").addEventListener("click", async () => {
  if (!app.pending) return;
  const res = await fetch("/api/review/cancel", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-YC": "1" },
    body: JSON.stringify({ request_id: app.pending.request_id }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); app.error = d.error || "取り消せませんでした"; }
  app.etag = null;
  await poll();
});

// ---------- やり直しの窓 ----------
const picked = new Set();

function openSheet() {
  picked.clear();
  $("note").value = "";
  $("sheetTitle").textContent = `${GATE_LABEL[app.gate]}をやり直す`;
  $("noteMax").textContent = String(app.noteMax);
  const box = $("tags");
  box.replaceChildren();
  for (const t of app.tags[app.gate] || []) {
    const b = el("button", { type: "button", class: "tag", "aria-pressed": "false" }, t);
    b.addEventListener("click", () => {
      if (picked.has(t)) picked.delete(t); else picked.add(t);
      b.setAttribute("aria-pressed", String(picked.has(t)));
      updateSheet();
    });
    box.append(b);
  }
  const m = currentBundle() && currentBundle().manifest;
  const v = m && m.views.find((x) => x.file === app.focus);
  $("focusText").textContent = `見ている絵: ${v ? v.label : "正面"}`;
  updateSheet();
  $("sheet").hidden = false; $("sheetBack").hidden = false;
  $("note").focus({ preventScroll: true });
}

function closeSheet() { $("sheet").hidden = true; $("sheetBack").hidden = true; }

function updateSheet() {
  const n = chars($("note").value.trim());
  const over = n > app.noteMax;
  const c = $("count");
  c.textContent = `${n}/${app.noteMax}`;
  c.className = over ? "over" : "";
  $("sendBtn").disabled = over || (n === 0 && picked.size === 0) || app.sending;
}

$("redoBtn").addEventListener("click", openSheet);
$("sheetCancel").addEventListener("click", closeSheet);
$("sheetBack").addEventListener("click", closeSheet);
$("note").addEventListener("input", updateSheet);
$("sendBtn").addEventListener("click", async () => {
  const ok = await send("redo", $("note").value.trim(), [...picked]);
  if (ok) closeSheet();
});

// ---------- 読み直しの間隔(見えている間 2 秒、隠れている間 15 秒) ----------
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => { await poll(); schedule(); }, document.hidden ? 15000 : 2000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); schedule(); });
poll().then(schedule);
