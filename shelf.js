"use strict";
// ชั้นหนังสือ หน้าหนังสือหนึ่งเล่ม และหน้าสถิติ
// ใช้ข้อมูลและฟังก์ชันจาก app.js: entries, getBooks, upsertBook, newBook, findBook, entriesOfBook, pagesReadOf,
// STATUSES, CATEGORIES, catLabel, getGoal, isScheduled, getYearGoal, yearGoalKey, markSettingsDirty, card, go, toast ...

let libTab = "shelf";
let openBookId = null;
let editingBookId = null;
let shelfBackfilled = false;

const fmtMins = m => {
  m = Math.round(m);
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} ชม. ${r} น.` : `${h} ชม.`) : `${r} นาที`;
};
const statusLabel = s => (STATUSES.find(x => x[0] === s) || STATUSES[1])[1];
const thisYear = () => new Date().getFullYear();
const yearLabel = y => new Date(y, 6, 1).toLocaleDateString("th-TH", { year: "numeric" });

// ความเร็วเฉลี่ย (หน้า/นาที) จากบันทึกที่มีทั้งจำนวนหน้าและเวลา
function readingSpeed(list = entries) {
  let p = 0, m = 0, n = 0;
  for (const e of list) { const pg = pagesOf(e), mi = +e.minutes || 0; if (pg > 0 && mi > 0) { p += pg; m += mi; n++; } }
  return n ? { ppm: p / m, n } : null;
}

// คาดการณ์วันอ่านจบ: อัตราหน้าต่อวันตั้งแต่เริ่มอ่าน
function bookForecast(b) {
  const read = pagesReadOf(b);
  if (!b.totalPages || !read || b.status === "done") return null;
  const left = Math.max(0, b.totalPages - read);
  if (!left) return { left: 0 };
  const list = entriesOfBook(b);
  const first = list.reduce((m, e) => e.date < m ? e.date : m, b.startedAt || todayStr());
  const days = Math.max(1, daysBetween(first, todayStr()) + 1);
  const perDay = read / days;
  const daysLeft = Math.ceil(left / perDay);
  const sp = readingSpeed(list) || readingSpeed();
  return { left, daysLeft, date: addDays(todayStr(), daysLeft), minsLeft: sp ? left / sp.ppm : null };
}

// ---------- ชั้นหนังสือ ----------
function bookCard(b) {
  const read = pagesReadOf(b);
  const pct = b.totalPages ? Math.min(100, Math.round(read / b.totalPages * 100)) : null;
  const fc = bookForecast(b);
  const meta = [b.author, b.category ? catLabel(b.category) : "", b.status === "done" && b.finishedAt ? `จบเมื่อ ${fmt(b.finishedAt)}` : ""].filter(Boolean).join(" · ");
  return `<button type="button" class="entry book-card" data-book="${esc(b.id)}">
    <span class="book-spine" aria-hidden="true"></span>
    <span class="book-main">
      <span class="entry-head"><h3>${esc(b.title)}</h3>${b.status === "done" ? `<span class="chip gold">✓ จบแล้ว</span>` : ""}</span>
      ${meta ? `<span class="meta">${esc(meta)}</span>` : ""}
      ${pct != null && b.status !== "want" ? `<span class="bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="meta">${read.toLocaleString("th-TH")} / ${b.totalPages.toLocaleString("th-TH")} หน้า · ${pct}%${fc?.daysLeft ? ` · น่าจะจบในอีก ~${fc.daysLeft} วัน` : ""}</span>`
        : b.status === "reading" && !b.totalPages ? `<span class="meta">ใส่จำนวนหน้าทั้งเล่ม เพื่อดูความคืบหน้า</span>` : ""}
    </span>
  </button>`;
}

function renderShelf() {
  const books = getBooks();
  const groups = STATUSES.map(([k, label]) => {
    let list = books.filter(b => b.status === k);
    list.sort(k === "done" ? (x, y) => (y.finishedAt || "").localeCompare(x.finishedAt || "") : (x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));
    return `<section class="shelf-group" aria-label="${label}">
      <h2>${label} <span class="count">${list.length}</span></h2>
      ${list.length ? `<div class="list">${list.map(bookCard).join("")}</div>`
        : `<p class="empty">${k === "reading" ? "ยังไม่มีเล่มที่กำลังอ่าน บันทึกการอ่านแล้วหนังสือจะขึ้นที่นี่เอง" : k === "want" ? "เพิ่มหนังสือที่อยากอ่านไว้ที่นี่ได้ (กองดอง)" : "ยังไม่มีเล่มที่อ่านจบ"}</p>`}
    </section>`;
  }).join("");
  $("shelfGroups").innerHTML = groups;
  $("shelfRandom").hidden = books.filter(b => b.status === "want").length < 2;
}

function fillBookFormSelects() {
  $("bfCat").innerHTML = `<option value="">ไม่ระบุ</option>` + CATEGORIES.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  $("bfStatus").innerHTML = STATUSES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
}
function openBookForm(b) {
  editingBookId = b?.id || null;
  fillBookFormSelects();
  $("bookFormTitle").textContent = b ? "แก้ไขข้อมูลหนังสือ" : "เพิ่มหนังสือ";
  $("bfTitle").value = b?.title || "";
  $("bfAuthor").value = b?.author || "";
  $("bfCat").value = b?.category || "";
  $("bfPages").value = b?.totalPages || "";
  $("bfStatus").value = b?.status || "want";
  $("bfMsg").textContent = "";
  $("bookForm").hidden = false;
  if (current !== "library") { libTab = "shelf"; go("library"); }
  $("bookForm").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  $("bfTitle").focus({ preventScroll: true });
}
function closeBookForm() { $("bookForm").hidden = true; editingBookId = null; }

$("shelfAdd").addEventListener("click", () => openBookForm(null));
$("bfCancel").addEventListener("click", closeBookForm);
$("bookForm").addEventListener("submit", ev => {
  ev.preventDefault();
  const title = $("bfTitle").value.trim();
  const pages = $("bfPages").value.trim();
  if (!title) { $("bfMsg").textContent = "ใส่ชื่อหนังสือ"; return; }
  if (pages && !(+pages >= 1 && +pages <= 20000)) { $("bfMsg").textContent = "จำนวนหน้าต้องอยู่ระหว่าง 1 ถึง 20,000"; return; }
  const dup = findBook(title);
  if (dup && dup.id !== editingBookId) { $("bfMsg").textContent = "มีหนังสือชื่อนี้ในชั้นแล้ว"; return; }
  const prev = editingBookId ? getBooks().find(b => b.id === editingBookId) : null;
  const status = $("bfStatus").value;
  const b = prev ? { ...prev } : newBook({});
  // เปลี่ยนชื่อหนังสือ: ให้บันทึกเดิมตามชื่อใหม่ด้วย
  if (prev && normTitle(prev.title) !== normTitle(title)) {
    for (const e of entries.filter(e => normTitle(e.book) === normTitle(prev.title))) upsert({ ...e, book: title });
  }
  Object.assign(b, { title, author: $("bfAuthor").value.trim(), category: $("bfCat").value, totalPages: pages ? Math.round(+pages) : null });
  setBookStatus(b, status, false);
  upsertBook(b);
  closeBookForm();
  toast(prev ? "บันทึกข้อมูลหนังสือแล้ว" : `เพิ่ม “${title}” ในชั้น${statusLabel(status)}แล้ว`);
  render();
});

function setBookStatus(b, status, save = true) {
  if (status === "reading" && !b.startedAt) b.startedAt = todayStr();
  if (status === "done") b.finishedAt = b.finishedAt || todayStr();
  if (status !== "done") b.finishedAt = null;
  b.status = status;
  if (save) upsertBook(b);
  return b;
}

// สุ่มเล่มถัดไปจากกองดอง
$("shelfRandom").addEventListener("click", () => {
  const want = getBooks().filter(b => b.status === "want");
  if (!want.length) return;
  const b = want[Math.floor(Math.random() * want.length)];
  $("shelfPick").hidden = false;
  $("shelfPick").innerHTML = `<p class="meta">🎲 เล่มถัดไปที่น่าอ่าน</p>
    <h3>${esc(b.title)}</h3>${b.author ? `<p class="meta">${esc(b.author)}</p>` : ""}
    <div class="actions"><button class="primary small" data-start-book="${esc(b.id)}">เริ่มอ่านเล่มนี้</button><button class="small" id="shelfReroll">สุ่มใหม่</button></div>`;
});

// ---------- หนังสือหนึ่งเล่ม ----------
function openBook(id) { openBookId = id; go("book"); }

function renderBook() {
  const b = getBooks().find(x => x.id === openBookId);
  if (!b) { $("bdCard").innerHTML = `<p class="note">ไม่พบหนังสือเล่มนี้ อาจถูกลบไปแล้ว</p>`; $("bdActions").innerHTML = ""; $("bdEntries").innerHTML = ""; return; }
  $("viewTitle").textContent = b.title;
  const list = entriesOfBook(b);
  const read = pagesReadOf(b);
  const mins = list.reduce((s, e) => s + (+e.minutes || 0), 0);
  const sp = readingSpeed(list);
  const fc = bookForecast(b);
  const pct = b.totalPages ? Math.min(100, Math.round(read / b.totalPages * 100)) : null;
  $("bdCard").innerHTML = `
    <div class="entry-head"><span class="chip">${esc(statusLabel(b.status))}</span>${b.category ? `<span class="chip quiet">${esc(catLabel(b.category))}</span>` : ""}</div>
    <h2 class="post-title">${esc(b.title)}</h2>
    ${b.author ? `<p class="book">${esc(b.author)}</p>` : ""}
    ${pct != null ? `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="อ่านไปแล้ว ${pct}%"><span style="width:${pct}%"></span></div>
      <p class="meta">อ่านถึงหน้า ${read.toLocaleString("th-TH")} จาก ${b.totalPages.toLocaleString("th-TH")} หน้า (${pct}%)</p>` : ""}
    <div class="mini-stats">
      <div><b>${list.length}</b><span>ครั้งที่บันทึก</span></div>
      <div><b>${fmtMins(mins)}</b><span>เวลาที่อ่าน</span></div>
      <div><b>${sp ? Math.round(sp.ppm * 60) : "–"}</b><span>หน้า/ชั่วโมง</span></div>
    </div>
    ${fc?.daysLeft ? `<p class="forecast">📅 ถ้าอ่านเท่านี้ต่อไป น่าจะอ่านจบประมาณ <b>${fmt(fc.date)}</b> (อีก ~${fc.daysLeft} วัน${fc.minsLeft ? ` · ใช้เวลาอ่านอีกราว ${fmtMins(fc.minsLeft)}` : ""})</p>` : ""}
    ${b.status === "done" && b.finishedAt ? `<p class="forecast">🎉 อ่านจบเมื่อ ${fmt(b.finishedAt)}${b.startedAt ? ` · ใช้เวลา ${daysBetween(b.startedAt, b.finishedAt) + 1} วัน` : ""}</p>` : ""}
    ${!b.totalPages ? `<p class="note">ใส่จำนวนหน้าทั้งเล่มในปุ่ม “แก้ไขข้อมูล” เพื่อดูความคืบหน้าและวันที่คาดว่าจะอ่านจบ</p>` : ""}`;
  $("bdActions").innerHTML = [
    b.status !== "done" ? `<button class="primary" data-write-book="${esc(b.id)}">+ บันทึกการอ่านเล่มนี้</button>` : "",
    b.status === "reading" ? `<button data-set-status="done">✓ อ่านจบแล้ว</button>` : "",
    b.status === "want" ? `<button data-set-status="reading">เริ่มอ่าน</button>` : "",
    b.status === "done" ? `<button data-set-status="reading">ย้ายกลับไปกำลังอ่าน</button>` : "",
    `<button data-edit-book>แก้ไขข้อมูล</button>`,
    `<button data-del-book>ลบออกจากชั้น</button>`
  ].join("");
  $("bdEntries").innerHTML = list.length ? byNewest(list).map(e => card(e)).join("")
    : `<p class="empty">ยังไม่มีบันทึกของเล่มนี้</p>`;
}

let delBookArmed = null;
document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t) return;
  if (t.dataset.lib) { libTab = t.dataset.lib; renderLibTabs(); return; }
  if (t.dataset.book) { openBook(t.dataset.book); return; }
  if (t.id === "shelfReroll") { $("shelfRandom").click(); return; }
  if (t.dataset.startBook) {
    const b = getBooks().find(x => x.id === t.dataset.startBook);
    if (b) { setBookStatus({ ...b }, "reading"); $("shelfPick").hidden = true; toast(`ย้าย “${b.title}” ไปชั้นกำลังอ่านแล้ว`); openBook(b.id); }
    return;
  }
  const b = getBooks().find(x => x.id === openBookId);
  if (!b || current !== "book") return;
  if (t.dataset.writeBook) { resetForm(); $("book").value = b.title; go("write"); return; }
  if (t.dataset.setStatus) {
    setBookStatus({ ...b }, t.dataset.setStatus);
    if (t.dataset.setStatus === "done") {
      const n = getBooks().filter(x => x.status === "done" && (x.finishedAt || "").startsWith(String(thisYear()))).length;
      toast(`🎉 อ่านจบเล่มที่ ${n} ของปีนี้แล้ว (เป้าหมาย ${getYearGoal().books} เล่ม)`);
    }
    render();
    return;
  }
  if (t.hasAttribute("data-edit-book")) { openBookForm(b); return; }
  if (t.hasAttribute("data-del-book")) {
    if (!delBookArmed) {
      t.textContent = "แตะอีกครั้งเพื่อลบ (บันทึกยังอยู่)";
      delBookArmed = setTimeout(() => { delBookArmed = null; if (current === "book") renderBook(); }, 3000);
      return;
    }
    clearTimeout(delBookArmed); delBookArmed = null;
    upsertBook({ id: b.id, title: b.title, deleted: true });
    toast("ลบหนังสือออกจากชั้นแล้ว บันทึกการอ่านยังอยู่ในคลัง");
    go("library");
  }
});

function renderLibTabs() {
  document.querySelectorAll("#libTabs [data-lib]").forEach(x => x.setAttribute("aria-selected", String(x.dataset.lib === libTab)));
  $("libShelf").hidden = libTab !== "shelf";
  $("libNotes").hidden = libTab !== "notes";
  if (libTab === "shelf") renderShelf();
}

// ---------- สถิติ (รายเดือน / รายปี) ----------
let statPeriod = "month";
let statMonth = todayStr().slice(0, 7);
let statYear = thisYear();
const donutSel = {}; // ส่วนของโดนัทที่แตะเลือกอยู่ แยกตามกราฟ
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const yearGoalOf = () => { const g = getYearGoal(); return { books: g.books || 12, pages: g.pages || 3000 }; };

const periodPrefix = () => statPeriod === "month" ? statMonth : String(statYear);
const inPeriod = ds => !!ds && ds.startsWith(periodPrefix());
const periodLabel = () => statPeriod === "month"
  ? new Date(statMonth + "-01T00:00:00").toLocaleDateString("th-TH", { month: "long", year: "numeric" })
  : `ปี ${yearLabel(statYear)}`;
const daysInMonth = ym => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const isCurrentPeriod = () => statPeriod === "month" ? statMonth === todayStr().slice(0, 7) : statYear === thisYear();

// ---- วงแหวนความคืบหน้า (SVG) ----
function ring(value, goal, { big, unit, label, tone }) {
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const r = 44, c = 2 * Math.PI * r;
  return `<figure class="ring ${tone}" aria-label="${esc(label)}: ${esc(big)} ${esc(unit)} (${Math.round(pct * 100)}%)">
    <svg viewBox="0 0 110 110" aria-hidden="true">
      <circle class="ring-track" cx="55" cy="55" r="${r}"/>
      <circle class="ring-fill" cx="55" cy="55" r="${r}" stroke-dasharray="${(c * pct).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 55 55)"/>
    </svg>
    <figcaption><b>${esc(big)}</b><span>${esc(unit)}</span><small>${esc(label)} · ${Math.round(pct * 100)}%</small></figcaption>
  </figure>`;
}

// ---- โดนัท (SVG) + รายการคำอธิบาย ----
// segs: [{key, label, v, color}] เรียงตามลำดับสีคงที่ (สีผูกกับหมวด ไม่ใช่ลำดับมากน้อย)
function donut(id, segs, { centerTop, centerSub }) {
  const total = segs.reduce((a, s) => a + s.v, 0);
  const r = 46, c = 2 * Math.PI * r, gap = segs.filter(s => s.v).length > 1 ? 2.2 : 0;
  let off = 0;
  const sel = segs.find(s => s.key === donutSel[id] && s.v);
  const arcs = segs.filter(s => s.v).map(s => {
    const len = s.v / total * c;
    const arc = `<circle class="donut-seg${sel && sel.key !== s.key ? " dim" : ""}" cx="60" cy="60" r="${r}" style="stroke:${s.color}"
      stroke-dasharray="${Math.max(0.01, len - gap).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"
      data-donut="${id}" data-key="${esc(s.key)}"><title>${esc(s.label)}: ${fmtMins(s.v)} (${Math.round(s.v / total * 100)}%)</title></circle>`;
    off += len;
    return arc;
  }).join("");
  const center = sel
    ? `<b>${Math.round(sel.v / total * 100)}%</b><span>${esc(sel.label)}</span><small>${fmtMins(sel.v)}</small>`
    : `<b>${esc(centerTop)}</b><span>${esc(centerSub)}</span>`;
  const rows = segs.filter(s => s.v).sort((a, b) => b.v - a.v).map(s => `
    <button type="button" class="legend-row${sel?.key === s.key ? " on" : ""}" data-donut="${id}" data-key="${esc(s.key)}" aria-pressed="${sel?.key === s.key}">
      <i style="background:${s.color}"></i><span class="lg-label">${esc(s.label)}</span>
      <span class="lg-bar"><span style="width:${(s.v / total * 100).toFixed(1)}%;background:${s.color}"></span></span>
      <span class="lg-val">${Math.round(s.v / total * 100)}%<small>${fmtMins(s.v)}</small></span>
    </button>`).join("");
  return `<div class="donut-wrap">
    <div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(centerSub)}">
      <circle class="donut-track" cx="60" cy="60" r="${r}"/>${arcs}</svg>
      <div class="donut-center">${center}</div></div>
    <div class="legend">${rows}</div>
  </div>`;
}

// ---- กราฟแท่งแนวตั้ง (ใช้ซ้ำ) ----
function barChart(id, bars, { goal, fmtV, xEvery = 1, readout }) {
  const max = Math.max(goal || 0, ...bars.map(b => b.v), 1);
  const nice = v => { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  const top = nice(max);
  const selKey = donutSel[id] ?? (bars.findLast(b => !b.future && b.v) || bars.findLast(b => !b.future))?.key;
  const sel = bars.find(b => b.key === selKey);
  return `<div class="wchart" style="--goal:${goal ? (goal / top * 100).toFixed(1) : -10}%;--n:${bars.length}">
      <div class="wchart-grid" aria-hidden="true"><span><em>${fmtV(top)}</em></span><span><em>${fmtV(top / 2)}</em></span><span><em>0</em></span></div>
      ${goal ? `<div class="wchart-goal" aria-hidden="true"><span>เป้า</span></div>` : ""}
      <div class="wchart-bars">${bars.map((b, i) => `
        <button type="button" class="wbar${b.key === selKey ? " sel" : ""}${goal && b.v >= goal ? " met" : ""}${b.v ? "" : " zero"}${b.future ? " future" : ""}"
          data-bar="${id}" data-key="${b.key}" aria-label="${esc(b.aria)}" aria-pressed="${b.key === selKey}">
          <span class="wbar-fill" style="height:${(b.v / top * 100).toFixed(1)}%"></span>
          ${i % xEvery === 0 || i === bars.length - 1 ? `<span class="wbar-x">${esc(b.x)}</span>` : ""}
        </button>`).join("")}</div>
    </div>
    ${sel ? `<p class="wchart-readout">${readout(sel)}</p>` : ""}`;
}

function renderRings() {
  const g = getGoal(), yg = yearGoalOf();
  if (statPeriod === "year") {
    const y = String(statYear);
    const done = getBooks().filter(b => b.status === "done" && (b.finishedAt || "").startsWith(y));
    const pages = entries.filter(e => e.date.startsWith(y)).reduce((s, e) => s + pagesOf(e), 0);
    let pace = "";
    if (isCurrentPeriod()) {
      const start = new Date(statYear, 0, 1), end = new Date(statYear + 1, 0, 1), frac = (Date.now() - start) / (end - start);
      const diff = done.length - yg.books * frac, left = yg.books - done.length;
      const monthsLeft = Math.max(0.5, (end - Date.now()) / (30.44 * 86400000));
      pace = done.length >= yg.books ? "🎉 ทำได้ตามเป้าจำนวนเล่มปีนี้แล้ว!"
        : (diff >= 0.5 ? `เร็วกว่าแผน ${Math.round(diff)} เล่ม` : diff > -0.5 ? "เป็นไปตามแผนพอดี" : `ช้ากว่าแผน ${Math.round(-diff)} เล่ม`)
          + ` · ต้องอ่านอีกเดือนละ ${(left / monthsLeft).toFixed(1)} เล่ม และ ${Math.max(0, Math.ceil((yg.pages - pages) / monthsLeft)).toLocaleString("th-TH")} หน้า`;
    }
    $("stRings").innerHTML = `
      <div class="goal-row"><h2>เป้าหมายปี ${esc(yearLabel(statYear))}</h2><button class="small" id="ycEdit">แก้เป้าหมาย</button></div>
      <div class="rings">
        ${ring(done.length, yg.books, { big: `${done.length}/${yg.books}`, unit: "เล่ม", label: "อ่านจบ", tone: "gold" })}
        ${ring(pages, yg.pages, { big: pages.toLocaleString("th-TH"), unit: `/ ${yg.pages.toLocaleString("th-TH")} หน้า`, label: "หน้าที่อ่าน", tone: "green" })}
      </div>
      ${pace ? `<p class="meta">${pace}</p>` : ""}
      <form class="row" id="ycForm" hidden novalidate>
        <label>เป้าจำนวนเล่มต่อปี<input type="number" id="ycBooks" min="1" max="1000" inputmode="numeric" value="${yg.books}"></label>
        <label>เป้าจำนวนหน้าต่อปี<input type="number" id="ycPages" min="1" max="1000000" inputmode="numeric" value="${yg.pages}"></label>
        <div class="actions end"><button class="primary" type="submit">บันทึก</button></div>
      </form>
      ${done.length ? `<p class="meta">อ่านจบแล้ว: ${done.slice(0, 6).map(b => esc(b.title)).join(" · ")}${done.length > 6 ? " …" : ""}</p>`
        : `<p class="note">กด “✓ อ่านจบแล้ว” ในหน้าหนังสือ แล้วเล่มนั้นจะนับเข้าเป้าหมายนี้</p>`}`;
  } else {
    const days = daysInMonth(statMonth), today = todayStr();
    let planned = 0, met = 0, mins = 0, goalMins = 0;
    for (let d = 1; d <= days; d++) {
      const ds = `${statMonth}-${String(d).padStart(2, "0")}`;
      const m = minutesOn(ds);
      mins += m;
      if (isScheduled(ds, g)) { goalMins += g.minutes; if (ds <= today) planned++; }
      if (goalMet(m, g)) met++;
    }
    $("stRings").innerHTML = `
      <div class="goal-row"><h2>${isCurrentPeriod() ? "เป้าหมายเดือนนี้" : "เป้าหมายรายวันของเดือน"}</h2><button class="small" data-go="calendar">ดูปฏิทิน</button></div>
      <div class="rings">
        ${ring(met, planned || 1, { big: `${met}/${planned}`, unit: "วัน", label: "ครบเป้ารายวัน", tone: "gold" })}
        ${ring(mins, goalMins, { big: fmtMins(mins), unit: `/ ${fmtMins(goalMins)}`, label: "เวลาอ่านทั้งเดือน", tone: "green" })}
      </div>
      <p class="meta">เป้ารายวัน ${g.minutes} นาที · ${isCurrentPeriod() ? "นับถึงวันนี้" : "ทั้งเดือน"}มี ${planned} วันที่ตั้งใจอ่าน</p>`;
  }
}

function renderTotals() {
  const list = entries.filter(e => inPeriod(e.date));
  const done = getBooks().filter(b => b.status === "done" && inPeriod(b.finishedAt)).length;
  const mins = list.reduce((s, e) => s + (+e.minutes || 0), 0);
  $("stTotals").innerHTML = `
    <div class="stat"><b>${done}</b><span>เล่มที่อ่านจบ</span></div>
    <div class="stat"><b>${list.reduce((s, e) => s + pagesOf(e), 0).toLocaleString("th-TH")}</b><span>หน้า</span></div>
    <div class="stat"><b>${(mins / 60).toFixed(mins >= 600 ? 0 : 1)}</b><span>ชั่วโมง</span></div>
    <div class="stat"><b>${new Set(list.map(e => e.date)).size}</b><span>วันที่อ่าน</span></div>`;
}

function renderTrend() {
  const today = todayStr();
  if (statPeriod === "month") {
    const g = getGoal(), days = daysInMonth(statMonth);
    const bars = [];
    for (let d = 1; d <= days; d++) {
      const ds = `${statMonth}-${String(d).padStart(2, "0")}`, v = minutesOn(ds);
      bars.push({ key: ds, v, x: String(d), future: ds > today, aria: `${fmt(ds)} อ่าน ${fmtMins(v)}${goalMet(v, g) ? " ครบเป้า" : ""}` });
    }
    $("stTrend").innerHTML = `<h2>เวลาอ่านรายวัน</h2><p class="meta">เส้นประคือเป้าวันละ ${g.minutes} นาที · แตะแท่งเพื่อดูตัวเลข</p>`
      + barChart("mday", bars, { goal: g.minutes, fmtV: v => `${Math.round(v)} น.`, xEvery: 5,
        readout: b => `<b>${fmt(b.key)}</b> อ่าน ${fmtMins(b.v)}${goalMet(b.v, g) ? " · ครบเป้า ✓" : ""}` });
  } else {
    const y = String(statYear), yg = yearGoalOf();
    const pages = Array(12).fill(0), books = Array(12).fill(0);
    for (const e of entries) if (e.date.startsWith(y)) pages[+e.date.slice(5, 7) - 1] += pagesOf(e);
    for (const b of getBooks()) if (b.status === "done" && (b.finishedAt || "").startsWith(y)) books[+b.finishedAt.slice(5, 7) - 1]++;
    const mk = (arr, unit) => arr.map((v, i) => { const key = `${y}-${String(i + 1).padStart(2, "0")}`; return { key, v, x: TH_MONTHS[i], future: key > today.slice(0, 7), aria: `${TH_MONTHS[i]} ${v.toLocaleString("th-TH")} ${unit}` }; });
    $("stTrend").innerHTML = `<h2>หน้าที่อ่านรายเดือน</h2><p class="meta">เส้นประคือเป้าเฉลี่ยเดือนละ ${Math.round(yg.pages / 12).toLocaleString("th-TH")} หน้า</p>`
      + barChart("ypages", mk(pages, "หน้า"), { goal: yg.pages / 12, fmtV: v => Math.round(v).toLocaleString("th-TH"), xEvery: 2,
        readout: b => `<b>${TH_MONTHS[+b.key.slice(5) - 1]}</b> อ่าน ${b.v.toLocaleString("th-TH")} หน้า` })
      + `<h2 class="sub-h">เล่มที่อ่านจบรายเดือน</h2>`
      + barChart("ybooks", mk(books, "เล่ม"), { goal: yg.books / 12, fmtV: v => (Math.round(v * 10) / 10).toLocaleString("th-TH"), xEvery: 2,
        readout: b => `<b>${TH_MONTHS[+b.key.slice(5) - 1]}</b> อ่านจบ ${b.v} เล่ม` });
  }
}

function renderCategories() {
  const by = {};
  for (const e of entries) {
    const m = +e.minutes || 0;
    if (!m || !inPeriod(e.date)) continue;
    const k = findBook(e.book)?.category || "";
    by[k] = (by[k] || 0) + m;
  }
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  // สีผูกกับหมวดตามลำดับคงที่ใน CATEGORIES; "ไม่ระบุ" เป็นสีเทาเสมอ
  const segs = [...CATEGORIES.map(([k, l], i) => ({ key: k, label: l, v: by[k] || 0, color: `var(--c${i + 1})` })),
    { key: "none", label: "ยังไม่ระบุหมวด", v: by[""] || 0, color: "var(--c-none)" }];
  const top = segs.filter(s => s.key !== "none" && s.v).sort((a, b) => b.v - a.v)[0];
  $("stCats").innerHTML = `<h2>อ่านหนังสือแนวไหนบ้าง</h2>` + (total
    ? `<p class="meta">สัดส่วนเวลาที่อ่านแต่ละหมวด${top ? ` · อ่าน<b>${esc(top.label)}</b>มากที่สุด` : ""} · แตะเพื่อดูรายละเอียด</p>`
      + donut("cats", segs, { centerTop: total >= 60 ? `${(total / 60).toFixed(total >= 600 ? 0 : 1)} ชม.` : `${total} นาที`, centerSub: "เวลาอ่านรวม" })
      + (by[""] ? `<p class="note">ระบุหมวดหมู่ได้ที่ ชั้นหนังสือ → เลือกเล่ม → แก้ไขข้อมูล</p>` : "")
    : `<p class="note">${statPeriod === "month" ? "เดือนนี้" : "ปีนี้"}ยังไม่มีบันทึกที่ใส่เวลาอ่าน</p>`);
}

const DAYPARTS = [["morning", "เช้า (05–11 น.)", 5, 11], ["afternoon", "บ่าย (11–17 น.)", 11, 17], ["evening", "เย็น (17–21 น.)", 17, 21], ["night", "ดึก (21–05 น.)", 21, 29]];
const DAYPART_TIP = { morning: "สมองสดชื่น เหมาะกับหนังสือที่ต้องใช้สมาธิ", afternoon: "ลองอ่านช่วงพักกลางวันสั้น ๆ", evening: "อ่านหลังเลิกงาน/เลิกเรียน ช่วยผ่อนคลาย", night: "อ่านก่อนนอนดี แต่อย่าลืมนอนให้พอนะ" };
function renderTimeOfDay() {
  const v = DAYPARTS.map(() => 0);
  let timed = 0;
  for (const e of entries) {
    const m = +e.minutes || 0, at = e.startedAt || e.created;
    if (!m || !at || !inPeriod(e.date)) continue;
    let h = new Date(at).getHours(); if (h < 5) h += 24;
    const i = DAYPARTS.findIndex(([, , a, b]) => h >= a && h < b);
    if (i >= 0) { v[i] += m; if (e.startedAt) timed++; }
  }
  const total = v.reduce((a, b) => a + b, 0);
  const segs = DAYPARTS.map(([k, l], i) => ({ key: k, label: l, v: v[i], color: `var(--c${i + 1})` }));
  const best = segs.reduce((a, b) => b.v > a.v ? b : a, segs[0]);
  $("stTime").innerHTML = `<h2>ช่วงเวลาที่อ่าน</h2>` + (total
    ? `<p class="meta">อ่านช่วง<b>${esc(best.label.split(" ")[0])}</b>บ่อยที่สุด · ${DAYPART_TIP[best.key]}</p>`
      + donut("time", segs, { centerTop: best.label.split(" ")[0], centerSub: "ช่วงที่อ่านบ่อยที่สุด" })
      + `<p class="note">${timed ? `อิงจากเวลาเริ่มจับเวลา (${timed} ครั้ง) และเวลาที่กดบันทึก` : "ตอนนี้อิงจากเวลาที่กดบันทึก ถ้าใช้ตัวจับเวลา จะได้เวลาเริ่มอ่านจริงที่แม่นกว่า"}</p>`
    : `<p class="note">${statPeriod === "month" ? "เดือนนี้" : "ปีนี้"}ยังไม่มีบันทึกที่ใส่เวลาอ่าน</p>`);
}

function renderSpeed() {
  const sp = readingSpeed();
  const reading = getBooks().filter(b => b.status === "reading").map(b => ({ b, fc: bookForecast(b) })).filter(x => x.fc?.daysLeft);
  $("stSpeed").innerHTML = `<h2>ความเร็วในการอ่าน <span class="count">ทั้งหมด</span></h2>` + (sp
    ? `<p class="hero-num"><b>${Math.round(sp.ppm * 60)}</b> หน้า/ชั่วโมง</p>
       <p class="meta">เฉลี่ยจาก ${sp.n} บันทึกที่ใส่ทั้งเลขหน้าและเวลา (${(1 / sp.ppm).toFixed(1)} นาทีต่อหน้า)</p>
       ${reading.length ? `<ul class="forecast-list">${reading.map(({ b, fc }) =>
         `<li><b>${esc(b.title)}</b> น่าจะจบประมาณ ${fmt(fc.date)} <span class="meta">(อีก ~${fc.daysLeft} วัน)</span></li>`).join("")}</ul>` : ""}`
    : `<p class="note">ใส่ทั้งเลขหน้าและเวลาที่อ่านในบันทึก แอปจะคำนวณความเร็วและคาดการณ์วันอ่านจบให้</p>`);
}

function renderStats() {
  document.querySelectorAll("#stPeriod [data-period]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.period === statPeriod)));
  $("stLabel").textContent = periodLabel();
  $("stNext").disabled = isCurrentPeriod();
  renderRings(); renderTotals(); renderTrend(); renderCategories(); renderTimeOfDay(); renderSpeed();
}

$("stPeriod").addEventListener("click", ev => {
  const b = ev.target.closest("[data-period]");
  if (!b) return;
  statPeriod = b.dataset.period;
  if (statPeriod === "year") statYear = +statMonth.slice(0, 4); else if (statMonth.slice(0, 4) !== String(statYear)) statMonth = `${statYear}-${statYear === thisYear() ? todayStr().slice(5, 7) : "12"}`;
  for (const k in donutSel) delete donutSel[k];
  renderStats();
});
function stepPeriod(n) {
  if (statPeriod === "month") { const [y, m] = statMonth.split("-").map(Number); statMonth = ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); statYear = +statMonth.slice(0, 4); }
  else statYear += n;
  for (const k in donutSel) delete donutSel[k];
  renderStats();
}
$("stPrev").addEventListener("click", () => stepPeriod(-1));
$("stNext").addEventListener("click", () => { if (!isCurrentPeriod()) stepPeriod(1); });

$("view-stats").addEventListener("click", ev => {
  const bar = ev.target.closest("[data-bar]");
  if (bar) { donutSel[bar.dataset.bar] = bar.dataset.key; renderTrend(); return; }
  const seg = ev.target.closest("[data-donut]");
  if (seg) {
    const id = seg.dataset.donut;
    donutSel[id] = donutSel[id] === seg.dataset.key ? null : seg.dataset.key;
    if (id === "cats") renderCategories(); else renderTimeOfDay();
    return;
  }
  if (ev.target.closest("#ycEdit")) { const f = $("ycForm"); f.hidden = !f.hidden; if (!f.hidden) $("ycBooks").focus(); }
});
$("view-stats").addEventListener("submit", ev => {
  if (ev.target.id !== "ycForm") return;
  ev.preventDefault();
  const n = Math.round(+$("ycBooks").value), p = Math.round(+$("ycPages").value);
  if (!(n >= 1 && n <= 1000)) { toast("ใส่จำนวนเล่มระหว่าง 1 ถึง 1,000"); return; }
  if (!(p >= 1 && p <= 1000000)) { toast("ใส่จำนวนหน้าระหว่าง 1 ถึง 1,000,000"); return; }
  lsSet(yearGoalKey(), { books: n, pages: p });
  markSettingsDirty();
  toast(`ตั้งเป้าปีนี้ ${n} เล่ม ${p.toLocaleString("th-TH")} หน้าแล้ว`);
  renderRings(); renderTrend();
});

// ---------- เชื่อมกับ app.js ----------
function onShelfRender(view) {
  // ผู้ใช้เดิมที่มีบันทึกอยู่แล้ว: สร้างหนังสือในชั้นจากบันทึกให้ครั้งแรก
  if (!shelfBackfilled && (mode !== "account" || serverSynced)) {
    shelfBackfilled = true;
    const missing = [...new Set(entries.map(e => e.book).filter(Boolean))].filter(t => !findBook(t));
    for (const t of missing) ensureBookFor(entries.filter(e => normTitle(e.book) === normTitle(t)).sort((a, b) => a.date.localeCompare(b.date))[0]);
  }
  if (view === "library") renderLibTabs();
  if (view !== "library") closeBookForm();
  if (view === "book") renderBook();
  if (view === "stats") renderStats();
}
