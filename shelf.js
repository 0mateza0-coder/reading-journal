"use strict";
// ชั้นหนังสือ หน้าหนังสือหนึ่งเล่ม และหน้าสถิติ
// ใช้ข้อมูลและฟังก์ชันจาก app.js: entries, getBooks, upsertBook, newBook, findBook, entriesOfBook, pagesReadOf,
// STATUSES, CATEGORIES, catLabel, getGoal, isScheduled, getYearGoal, yearGoalKey, markSettingsDirty, card, go, toast ...

let libTab = "shelf";
let openBookId = null;
let editingBookId = null;
let shelfBackfilled = false;
let weekSel = null; // สัปดาห์ที่แตะดูในกราฟ

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

// ---------- สถิติ ----------
// วันจันทร์ของสัปดาห์ที่มีวันที่นี้
const weekStart = ds => { const d = new Date(ds + "T00:00:00"); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return ymd(d); };
const shortDate = ds => { const d = new Date(ds + "T00:00:00"); return `${d.getDate()}/${d.getMonth() + 1}`; };

function renderChallenge() {
  const y = thisYear(), goal = getYearGoal().books;
  const done = getBooks().filter(b => b.status === "done" && (b.finishedAt || "").startsWith(String(y)));
  const start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
  const frac = (Date.now() - start) / (end - start);
  const expected = goal * frac;
  const diff = done.length - expected;
  const pct = Math.min(100, Math.round(done.length / goal * 100));
  const pace = done.length >= goal ? `🎉 ทำได้ตามเป้าปีนี้แล้ว!`
    : diff >= 0.5 ? `เร็วกว่าแผน ${Math.round(diff)} เล่ม เยี่ยมมาก`
    : diff > -0.5 ? `เป็นไปตามแผนพอดี`
    : `ช้ากว่าแผน ${Math.round(-diff)} เล่ม ยังทันนะ`;
  const left = goal - done.length, weeksLeft = Math.max(1, Math.round((end - Date.now()) / (7 * 86400000)));
  $("stChallenge").innerHTML = `
    <div class="goal-row"><h2>ความท้าทายการอ่านปี ${esc(yearLabel(y))}</h2><button class="small" id="ycEdit">แก้เป้าหมาย</button></div>
    <p class="challenge-num"><b>${done.length}</b> / ${goal} เล่ม</p>
    <div class="bar challenge-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="อ่านจบ ${done.length} จาก ${goal} เล่ม">
      <span style="width:${pct}%"></span><i style="left:${Math.min(100, frac * 100).toFixed(1)}%" title="ควรอ่านถึงตรงนี้แล้วตามแผน"></i>
    </div>
    <p class="meta">${pace}${left > 0 ? ` · เหลืออีก ${left} เล่ม ประมาณ ${(left / weeksLeft * 4.345).toFixed(1)} เล่มต่อเดือน` : ""}</p>
    <form class="row" id="ycForm" hidden novalidate>
      <label>ปีนี้ตั้งใจอ่านจบกี่เล่ม<input type="number" id="ycBooks" min="1" max="1000" inputmode="numeric" value="${goal}"></label>
      <div class="actions end"><button class="primary" type="submit">บันทึก</button></div>
    </form>
    ${done.length ? `<p class="meta">เล่มที่จบแล้ว: ${done.slice(0, 6).map(b => esc(b.title)).join(" · ")}${done.length > 6 ? " …" : ""}</p>` : `<p class="note">กด “✓ อ่านจบแล้ว” ในหน้าหนังสือ แล้วเล่มนั้นจะนับเข้าเป้าหมายนี้</p>`}`;
}

function renderYearTotals() {
  const y = String(thisYear());
  const list = entries.filter(e => e.date.startsWith(y));
  const done = getBooks().filter(b => b.status === "done" && (b.finishedAt || "").startsWith(y)).length;
  const mins = list.reduce((s, e) => s + (+e.minutes || 0), 0);
  $("stYear").innerHTML = `
    <div class="stat"><b>${done}</b><span>เล่มที่จบปีนี้</span></div>
    <div class="stat"><b>${list.reduce((s, e) => s + pagesOf(e), 0).toLocaleString("th-TH")}</b><span>หน้า</span></div>
    <div class="stat"><b>${(mins / 60).toFixed(mins >= 600 ? 0 : 1)}</b><span>ชั่วโมง</span></div>
    <div class="stat"><b>${new Set(list.map(e => e.date)).size}</b><span>วันที่อ่าน</span></div>`;
}

function renderSpeed() {
  const sp = readingSpeed();
  const reading = getBooks().filter(b => b.status === "reading").map(b => ({ b, fc: bookForecast(b) })).filter(x => x.fc?.daysLeft);
  $("stSpeed").innerHTML = `<h2>ความเร็วในการอ่าน</h2>` + (sp
    ? `<p class="hero-num"><b>${Math.round(sp.ppm * 60)}</b> หน้า/ชั่วโมง</p>
       <p class="meta">เฉลี่ยจาก ${sp.n} บันทึกที่ใส่ทั้งเลขหน้าและเวลา (${(1 / sp.ppm).toFixed(1)} นาทีต่อหน้า)</p>
       ${reading.length ? `<ul class="forecast-list">${reading.map(({ b, fc }) =>
         `<li><b>${esc(b.title)}</b> น่าจะจบประมาณ ${fmt(fc.date)} <span class="meta">(อีก ~${fc.daysLeft} วัน)</span></li>`).join("")}</ul>` : ""}`
    : `<p class="note">ใส่ทั้งเลขหน้าและเวลาที่อ่านในบันทึก แอปจะคำนวณความเร็วและคาดการณ์วันอ่านจบให้</p>`);
}

// กราฟแท่ง: นาทีที่อ่านต่อสัปดาห์ 8 สัปดาห์ล่าสุด พร้อมเส้นเป้าหมายรายสัปดาห์
function renderWeeks() {
  const g = getGoal();
  const thisWk = weekStart(todayStr());
  const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push(addDays(thisWk, -7 * i));
  const mins = Object.fromEntries(weeks.map(w => [w, 0]));
  for (const e of entries) { const w = weekStart(e.date); if (w in mins) mins[w] += +e.minutes || 0; }
  const weekGoal = g.minutes * g.days.length;
  const max = Math.max(weekGoal, ...Object.values(mins), 1);
  const top = Math.ceil(max / 30) * 30; // ปัดสเกลเป็นหลักครึ่งชั่วโมง
  if (weekSel == null || !weeks.includes(weekSel)) weekSel = thisWk;
  const met = weeks.filter(w => mins[w] >= weekGoal).length;
  const sel = mins[weekSel];
  $("stWeeks").innerHTML = `
    <h2>เวลาอ่าน 8 สัปดาห์ล่าสุด</h2>
    <p class="meta">ครบเป้าสัปดาห์ละ ${fmtMins(weekGoal)} ไป ${met} จาก 8 สัปดาห์ · แตะแท่งเพื่อดูตัวเลข</p>
    <div class="wchart" style="--goal:${(weekGoal / top * 100).toFixed(1)}%">
      <div class="wchart-grid" aria-hidden="true"><span><em>${fmtMins(top)}</em></span><span><em>${fmtMins(top / 2)}</em></span><span><em>0</em></span></div>
      <div class="wchart-goal" aria-hidden="true"><span>เป้า</span></div>
      <div class="wchart-bars">${weeks.map(w => `
        <button type="button" class="wbar${w === weekSel ? " sel" : ""}${mins[w] >= weekGoal ? " met" : ""}${mins[w] ? "" : " zero"}" data-week="${w}"
          aria-label="สัปดาห์ที่เริ่ม ${fmt(w)} อ่าน ${fmtMins(mins[w])}${mins[w] >= weekGoal ? " ครบเป้า" : ""}" aria-pressed="${w === weekSel}">
          <span class="wbar-fill" style="height:${(mins[w] / top * 100).toFixed(1)}%"></span>
          <span class="wbar-x">${w === thisWk ? "นี้" : shortDate(w)}</span>
        </button>`).join("")}</div>
    </div>
    <p class="wchart-readout"><b>${w2label(weekSel, thisWk)}</b> อ่าน ${fmtMins(sel)}${sel >= weekGoal ? " · ครบเป้า ✓" : ` · ขาดอีก ${fmtMins(weekGoal - sel)}`}</p>`;
}
const w2label = (w, thisWk) => w === thisWk ? "สัปดาห์นี้" : `${fmt(w)} – ${fmt(addDays(w, 6))}`;

// แถบแนวนอน: ใช้กับหมวดหมู่และช่วงเวลา (สีเดียว ตัวหนังสือบอกชื่อ)
function hbars(rows, total) {
  const max = Math.max(...rows.map(r => r.v), 1);
  return `<div class="hbars">${rows.map(r => `
    <div class="hbar" title="${esc(r.label)}: ${fmtMins(r.v)} (${Math.round(r.v / total * 100)}%)">
      <span class="hbar-label">${esc(r.label)}</span>
      <span class="hbar-track"><span class="hbar-fill${r.top ? " top" : ""}" style="width:${(r.v / max * 100).toFixed(1)}%"></span></span>
      <span class="hbar-val">${Math.round(r.v / total * 100)}%<small>${fmtMins(r.v)}</small></span>
    </div>`).join("")}</div>`;
}

function renderCategories() {
  const by = {};
  for (const e of entries) {
    const m = +e.minutes || 0;
    if (!m) continue;
    const k = findBook(e.book)?.category || "";
    by[k] = (by[k] || 0) + m;
  }
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const rows = Object.entries(by).map(([k, v]) => ({ label: k ? catLabel(k) : "ยังไม่ระบุหมวด", v, k })).sort((a, b) => b.v - a.v);
  if (rows[0]) rows[0].top = true;
  const named = rows.filter(r => r.k);
  $("stCats").innerHTML = `<h2>อ่านหนังสือแนวไหนบ้าง</h2>` + (total
    ? `<p class="meta">สัดส่วนเวลาที่อ่านแต่ละหมวด${named.length ? ` · อ่าน${named[0].label}มากที่สุด` : ""}</p>${hbars(rows, total)}
       ${by[""] ? `<p class="note">ระบุหมวดหมู่ได้ในหน้าหนังสือแต่ละเล่ม (ชั้นหนังสือ → เลือกเล่ม → แก้ไขข้อมูล)</p>` : ""}`
    : `<p class="note">บันทึกเวลาที่อ่าน แล้วระบุหมวดหมู่ของหนังสือในชั้นหนังสือ จะเห็นสัดส่วนที่นี่</p>`);
}

const DAYPARTS = [["เช้า (05–11 น.)", 5, 11], ["บ่าย (11–17 น.)", 11, 17], ["เย็น (17–21 น.)", 17, 21], ["ดึก (21–05 น.)", 21, 29]];
function renderTimeOfDay() {
  const v = DAYPARTS.map(() => 0);
  let timed = 0;
  for (const e of entries) {
    const m = +e.minutes || 0;
    const at = e.startedAt || e.created;
    if (!m || !at) continue;
    let h = new Date(at).getHours(); if (h < 5) h += 24;
    const i = DAYPARTS.findIndex(([, a, b]) => h >= a && h < b);
    if (i >= 0) { v[i] += m; if (e.startedAt) timed++; }
  }
  const total = v.reduce((a, b) => a + b, 0);
  const rows = DAYPARTS.map(([label], i) => ({ label, v: v[i] }));
  const best = rows.reduce((a, b) => b.v > a.v ? b : a, rows[0]);
  best.top = total > 0;
  const tip = { "เช้า": "สมองสดชื่น เหมาะกับหนังสือที่ต้องใช้สมาธิ", "บ่าย": "ลองอ่านช่วงพักกลางวันสั้น ๆ", "เย็น": "อ่านหลังเลิกงาน/เลิกเรียน ช่วยผ่อนคลาย", "ดึก": "อ่านก่อนนอนดี แต่อย่าลืมนอนให้พอนะ" }[best.label.split(" ")[0]];
  $("stTime").innerHTML = `<h2>ช่วงเวลาที่อ่าน</h2>` + (total
    ? `<p class="meta">คุณอ่านช่วง<b>${esc(best.label.split(" ")[0])}</b>บ่อยที่สุด · ${tip}</p>${hbars(rows.filter(r => r.v), total)}
       <p class="note">${timed ? `อิงจากเวลาเริ่มจับเวลา (${timed} ครั้ง) และเวลาที่กดบันทึก` : "ตอนนี้อิงจากเวลาที่กดบันทึก ถ้าใช้ตัวจับเวลา จะได้เวลาเริ่มอ่านจริงที่แม่นกว่า"}</p>`
    : `<p class="note">บันทึกเวลาที่อ่าน แล้วจะเห็นว่าคุณอ่านช่วงไหนของวันบ่อยที่สุด</p>`);
}

function renderStats() {
  renderChallenge(); renderYearTotals(); renderSpeed(); renderWeeks(); renderCategories(); renderTimeOfDay();
}

$("view-stats").addEventListener("click", ev => {
  const w = ev.target.closest("[data-week]");
  if (w) { weekSel = w.dataset.week; renderWeeks(); return; }
  if (ev.target.closest("#ycEdit")) { const f = $("ycForm"); f.hidden = !f.hidden; if (!f.hidden) $("ycBooks").focus(); }
});
$("view-stats").addEventListener("submit", ev => {
  if (ev.target.id !== "ycForm") return;
  ev.preventDefault();
  const n = Math.round(+$("ycBooks").value);
  if (!(n >= 1 && n <= 1000)) { toast("ใส่จำนวนเล่มระหว่าง 1 ถึง 1,000"); return; }
  lsSet(yearGoalKey(), { books: n });
  markSettingsDirty();
  toast(`ตั้งเป้าปีนี้ ${n} เล่มแล้ว`);
  renderChallenge();
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
