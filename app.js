"use strict";

// รอบทบทวน (วันหลังจากวันที่อ่าน)
const INTERVALS = [1, 3, 7, 30];
const STORAGE_KEY = "reading-journal-entries";
const NOTIFIED_KEY = "reading-journal-notified";
const FIELDS = ["date", "book", "chapter", "pFrom", "pTo", "minutes", "goal", "k1", "k2", "k3", "summary", "questions", "apply", "quote"];
const NUMERIC = ["pFrom", "pTo", "minutes"];
const TITLES = { login: "สมุดบันทึกการอ่าน", home: "สมุดบันทึกการอ่าน", write: "บันทึกวันนี้", calendar: "ปฏิทินการอ่าน", library: "คลังบันทึก", review: "ทบทวน", settings: "ตั้งค่า" };

const $ = id => document.getElementById(id);
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const fmt = s => new Date(s + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const EXAMPLE = {
  id: "example", example: true, date: todayStr(), book: "Atomic Habits", chapter: "บทที่ 1", pFrom: 1, pTo: 24, minutes: 30,
  goal: "ทำไมนิสัยเล็ก ๆ ถึงสำคัญ",
  k1: "ดีขึ้นวันละ 1% ผ่านไปหนึ่งปีจะดีขึ้นราว 37 เท่า", k2: "ระบบสำคัญกว่าเป้าหมาย", k3: "ผลลัพธ์มาช้า ต้องผ่านช่วงที่ยังไม่เห็นผล",
  summary: "การเปลี่ยนแปลงเล็ก ๆ ที่ทำทุกวันจะสะสมจนเห็นผลใหญ่ คนส่วนใหญ่เลิกก่อนถึงจุดที่ผลเริ่มปรากฏ",
  questions: "", apply: "อ่านหนังสือวันละ 10 หน้าทุกคืนก่อนนอน", quote: "", rating: 4, recall: true
};

// ---------- ข้อมูล ----------
// โหมด "guest": เก็บในเครื่องอย่างเดียว
// โหมด "account": เก็บสำเนาในเครื่อง (ใช้ออฟไลน์ได้) แล้วซิงก์ขึ้น Supabase
const GUEST_CHOSEN_KEY = "reading-journal-guest";
const LAST_USER_KEY = "reading-journal-last-user";
const MIGRATE_SKIP_KEY = "reading-journal-migrate-skip";

let mode = "guest";
let user = null;            // { id, email }
let entries = [];
let editingId = null;
let reviewingId = null;
let pendingDelete = null;

const lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };

const cacheKey = () => mode === "account" ? `${STORAGE_KEY}:${user.id}` : STORAGE_KEY;
const pendingKey = () => `reading-journal-pending:${user.id}`;

function load() { return lsGet(cacheKey(), []); }
function persist() {
  if (lsSet(cacheKey(), entries)) return true;
  toast("บันทึกไม่สำเร็จ พื้นที่ในเครื่องอาจเต็ม");
  return false;
}
function upsert(e) {
  e.updatedAt = new Date().toISOString();
  const i = entries.findIndex(x => x.id === e.id);
  if (i >= 0) entries[i] = e; else entries.push(e);
  if (!persist()) return false;
  if (mode === "account") queue("up", e.id);
  return true;
}
function remove(id) {
  entries = entries.filter(x => x.id !== id);
  persist();
  if (mode === "account") queue("del", id);
}

// ---------- ซิงก์กับ Supabase ----------
const cfg = window.APP_CONFIG || {};
const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
const sb = configured && window.supabase?.createClient ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

function getPending() { return lsGet(pendingKey(), { up: [], del: [] }); }
const goalPendingKey = () => `reading-journal-pending-goal:${user.id}`;
const goalPending = () => mode === "account" && lsGet(goalPendingKey(), false);
function queue(kind, id) {
  const p = getPending();
  p.up = p.up.filter(x => x !== id);
  p.del = p.del.filter(x => x !== id);
  p[kind].push(id);
  lsSet(pendingKey(), p);
  flush();
}

let syncing = false, syncError = false;
function setSync() {
  const el = $("syncState");
  if (mode !== "account") { el.textContent = ""; return; }
  const n = (() => { const p = getPending(); return p.up.length + p.del.length + (goalPending() ? 1 : 0); })();
  el.classList.toggle("warn", n > 0 || syncError);
  el.textContent = syncing ? "กำลังซิงก์…" : n ? `รอซิงก์ ${n} รายการ` : syncError ? "ซิงก์ไม่สำเร็จ" : "ซิงก์แล้ว";
}

async function flush() {
  if (mode !== "account" || !sb || syncing || !navigator.onLine) { setSync(); return; }
  const p = getPending();
  const sendGoal = goalPending();
  if (!p.up.length && !p.del.length && !sendGoal) { setSync(); return; }
  syncing = true; setSync();
  try {
    if (sendGoal) {
      const { error } = await sb.from("settings").upsert({ data: { goal: getGoal() }, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      lsDel(goalPendingKey());
    }
    const rows = p.up.map(id => entries.find(e => e.id === id)).filter(Boolean)
      .map(e => ({ id: e.id, data: e, updated_at: e.updatedAt || new Date().toISOString() }));
    if (rows.length) {
      const { error } = await sb.from("entries").upsert(rows, { onConflict: "user_id,id" });
      if (error) throw error;
    }
    if (p.del.length) {
      const { error } = await sb.from("entries").delete().in("id", p.del);
      if (error) throw error;
    }
    // เอาออกจากคิวเฉพาะที่ส่งไปแล้ว (ระหว่างส่งอาจมีรายการใหม่เข้ามา)
    const now = getPending();
    now.up = now.up.filter(id => !p.up.includes(id) || entries.find(e => e.id === id)?.updatedAt !== rows.find(r => r.id === id)?.data.updatedAt);
    now.del = now.del.filter(id => !p.del.includes(id));
    lsSet(pendingKey(), now);
    syncError = false;
  } catch (err) {
    console.warn("sync failed", err);
    syncError = true;
  } finally {
    syncing = false; setSync();
  }
  const left = getPending();
  if (!syncError && (left.up.length || left.del.length)) flush();
}

async function pull() {
  if (mode !== "account" || !sb || !navigator.onLine) return;
  await flush();
  const p = getPending();
  if (p.up.length || p.del.length) return; // ยังส่งไม่ครบ อย่าเพิ่งทับข้อมูลในเครื่อง
  const { data, error } = await sb.from("entries").select("id, data");
  if (error) { syncError = true; setSync(); return; }
  entries = data.map(r => ({ ...r.data, id: r.id }));
  persist();
  if (!goalPending()) {
    const s = await sb.from("settings").select("data").maybeSingle();
    const g = s.data?.data?.goal;
    if (!s.error && g && Number.isFinite(+g.minutes) && Array.isArray(g.days)) lsSet(goalKey(), { minutes: +g.minutes, days: g.days });
  }
  syncError = false; setSync();
  render();
}

// ---------- ล็อกอิน ----------
let authMode = "signin"; // signin | signup | forgot

function setAuthMode(m) {
  authMode = m;
  const t = { signin: "เข้าสู่ระบบ", signup: "สมัครสมาชิก", forgot: "ลืมรหัสผ่าน" }[m];
  $("authTitle").textContent = t;
  $("authSubmit").textContent = m === "forgot" ? "ส่งลิงก์ตั้งรหัสผ่านใหม่" : t;
  $("pwLabel").hidden = m === "forgot";
  $("authPassword").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("toggleMode").textContent = m === "signin" ? "ยังไม่มีบัญชี? สมัครสมาชิก" : "มีบัญชีแล้ว? เข้าสู่ระบบ";
  $("forgotBtn").hidden = m !== "signin";
  $("authIntro").textContent = m === "forgot"
    ? "ใส่อีเมลที่ใช้สมัคร ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้"
    : "บันทึกจะเก็บไว้ในบัญชีของคุณ เปิดได้จากทุกเครื่อง";
  authMsg("");
}
function authMsg(text, isError = false) {
  $("authMsg").textContent = text;
  $("authMsg").classList.toggle("error", isError);
}
function thaiAuthError(err) {
  const m = (err?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (m.includes("email not confirmed")) return "ยังไม่ได้ยืนยันอีเมล เปิดลิงก์ยืนยันในอีเมลก่อน แล้วลองเข้าสู่ระบบอีกครั้ง";
  if (m.includes("already registered")) return "อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน";
  if (m.includes("password")) return "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
  if (m.includes("rate limit") || err?.status === 429) return "ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่";
  if (m.includes("fetch") || m.includes("network")) return "เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
  return "ทำรายการไม่สำเร็จ: " + (err?.message || "ไม่ทราบสาเหตุ");
}

$("toggleMode").addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
$("forgotBtn").addEventListener("click", () => setAuthMode("forgot"));
$("guestBtn").addEventListener("click", () => { lsSet(GUEST_CHOSEN_KEY, true); enterGuest(); });

$("authForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (!sb) { authMsg("โหลดระบบล็อกอินไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วเปิดแอปใหม่", true); return; }
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { authMsg("กรอกอีเมลให้ถูกต้อง", true); return; }
  if (authMode !== "forgot" && password.length < 6) { authMsg("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", true); return; }
  const btn = $("authSubmit");
  btn.disabled = true; authMsg("กำลังดำเนินการ…");
  const redirectTo = location.origin + location.pathname;
  try {
    if (authMode === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      authMsg("");
    } else if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      if (!data.session) authMsg(`ส่งอีเมลยืนยันไปที่ ${email} แล้ว เปิดลิงก์ในอีเมลเพื่อเริ่มใช้งาน`);
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      authMsg(`ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${email} แล้ว`);
    }
  } catch (err) {
    authMsg(thaiAuthError(err), true);
  } finally {
    btn.disabled = false;
  }
});

$("recoveryForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const pw = $("newPassword").value;
  if (pw.length < 6) { $("recoveryMsg").textContent = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"; return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) { $("recoveryMsg").textContent = thaiAuthError(error); return; }
  $("recoveryForm").hidden = true;
  $("authCard").hidden = false;
  toast("ตั้งรหัสผ่านใหม่แล้ว");
  if (user) { document.body.classList.remove("auth"); go("home"); }
});

function showLogin() {
  document.body.classList.add("auth");
  setAuthMode("signin");
  go("login");
}

function enterGuest() {
  mode = "guest"; user = null;
  entries = load();
  document.body.classList.remove("auth");
  setSync();
  go("home");
}

function enterAccount(u) {
  mode = "account";
  user = { id: u.id, email: u.email };
  lsSet(LAST_USER_KEY, user);
  lsDel(GUEST_CHOSEN_KEY);
  entries = load();
  document.body.classList.remove("auth");
  setSync();
  go("home");
  pull();
}

$("signInBtn").addEventListener("click", showLogin);
$("signOutBtn").addEventListener("click", async () => {
  const p = getPending();
  if (p.up.length || p.del.length || goalPending()) {
    $("accountMsg").textContent = "ยังมีบันทึกที่ยังไม่ได้ซิงก์ เชื่อมต่ออินเทอร์เน็ตแล้วรอให้ขึ้นว่า “ซิงก์แล้ว” ก่อนออกจากระบบ";
    flush();
    return;
  }
  try { await sb?.auth.signOut(); } catch {}
  // ลบสำเนาในเครื่อง เพื่อไม่ให้คนอื่นที่ใช้เครื่องนี้เห็น
  lsDel(cacheKey()); lsDel(pendingKey()); lsDel(goalKey()); lsDel(goalPendingKey()); lsDel(LAST_USER_KEY);
  entries = []; user = null; mode = "guest";
  setSync();
  showLogin();
});

// บันทึกที่เขียนไว้ตอนยังไม่ล็อกอิน
function guestEntries() { return lsGet(STORAGE_KEY, []); }
function renderMigrate() {
  const list = mode === "account" ? guestEntries() : [];
  const skip = lsGet(MIGRATE_SKIP_KEY, false);
  $("migrateCard").hidden = !list.length || skip;
  $("migrateText").textContent = `มี ${list.length} บันทึกที่เขียนไว้ในเครื่องนี้ก่อนล็อกอิน ย้ายเข้าบัญชี ${user?.email || ""} เพื่อเปิดได้จากทุกเครื่อง`;
}
$("migrateBtn").addEventListener("click", () => {
  const list = guestEntries();
  for (const e of list) if (!entries.some(x => x.id === e.id)) upsert({ ...e });
  lsDel(STORAGE_KEY);
  toast(`ย้าย ${list.length} บันทึกเข้าบัญชีแล้ว`);
  render();
});
$("migrateSkip").addEventListener("click", () => { lsSet(MIGRATE_SKIP_KEY, true); render(); });
const dueEntries = () => entries.filter(e => e.step < INTERVALS.length && e.nextReview <= todayStr())
  .sort((a, b) => a.nextReview.localeCompare(b.nextReview));
const byNewest = list => [...list].sort((a, b) => (b.date + (b.created || "")).localeCompare(a.date + (a.created || "")));

// ---------- การนำทาง ----------
let current = "home";
function go(view) {
  if (view !== "write" && current === "write" && editingId) resetForm();
  current = view;
  // ฟอร์มใหม่ที่ยังไม่ได้กรอก ให้วันที่เป็นวันนี้เสมอ (ร่างที่กรอกค้างไว้จะไม่ถูกล้าง)
  if (view === "write" && !editingId && !$("book").value) $("date").value = todayStr();
  document.querySelectorAll(".view").forEach(v => v.hidden = v.id !== "view-" + view);
  document.querySelectorAll(".tabs button").forEach(b => {
    if (b.dataset.go === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $("viewTitle").textContent = view === "write" && editingId ? "แก้ไขบันทึก" : TITLES[view];
  window.scrollTo(0, 0);
  render();
}

// ---------- แสดงผล ----------
function reviewChip(e) {
  if (e.example) return `<span class="chip example">ตัวอย่าง</span>`;
  if (e.step >= INTERVALS.length) return `<span class="chip">ทบทวนครบแล้ว</span>`;
  if (e.nextReview <= todayStr()) return `<span class="chip due">ถึงรอบทบทวน</span>`;
  return `<span class="chip">ทบทวน ${fmt(e.nextReview)}</span>`;
}
function metaLine(e) {
  const pages = e.pFrom != null || e.pTo != null ? `หน้า ${e.pFrom ?? "?"}–${e.pTo ?? "?"}` : "";
  return [fmt(e.date), e.chapter, pages, e.minutes ? e.minutes + " นาที" : "", e.rating ? "เข้าใจ " + e.rating + "/5" : ""].filter(Boolean).join(" · ");
}
function bodyHtml(e) {
  const pts = [e.k1, e.k2, e.k3].filter(Boolean);
  return `${pts.length ? `<ol>${pts.map(p => `<li>${esc(p)}</li>`).join("")}</ol>` : ""}
    ${e.summary ? `<p>${esc(e.summary)}</p>` : ""}
    ${e.questions ? `<p><span class="lbl">สงสัย:</span> ${esc(e.questions)}</p>` : ""}
    ${e.apply ? `<p><span class="lbl">นำไปใช้:</span> ${esc(e.apply)}</p>` : ""}
    ${e.quote ? `<p><span class="lbl">ประโยคที่ชอบ:</span> “${esc(e.quote)}”</p>` : ""}`;
}
function card(e, withActions = true) {
  return `<article class="entry">
    <div class="entry-head"><h3>${esc(e.book)}</h3>${reviewChip(e)}</div>
    <p class="meta">${esc(metaLine(e))}</p>
    ${bodyHtml(e)}
    ${withActions && !e.example ? `<div class="entry-actions">
      <button class="small" data-edit="${e.id}">แก้ไข</button>
      <button class="small" data-del="${e.id}">${pendingDelete === e.id ? "กดอีกครั้งเพื่อลบ" : "ลบ"}</button></div>` : ""}
  </article>`;
}

function renderStats() {
  const pages = entries.reduce((s, e) => s + (e.pTo != null && e.pFrom != null && e.pTo >= e.pFrom ? e.pTo - e.pFrom + 1 : 0), 0);
  const mins = entries.reduce((s, e) => s + (+e.minutes || 0), 0);
  const { current: streak, best } = goalStreaks();
  $("sStreak").textContent = streak;
  $("sBest").textContent = best ? `สูงสุด ${best} วัน` : "";
  $("sPages").textContent = pages.toLocaleString("th-TH");
  $("sMin").textContent = mins.toLocaleString("th-TH");
}

function renderHome() {
  $("todayLabel").textContent = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  renderStats();
  const due = dueEntries();
  $("dueList").innerHTML = due.length
    ? due.map(e => `<div class="due-item">
        <p><b>${esc(e.book)}</b> ${esc(e.chapter || "")}<br><span class="meta">รอบที่ ${e.step + 1} จาก ${INTERVALS.length}</span></p>
        <button class="small primary" data-review="${e.id}">ทบทวน</button></div>`).join("")
    : `<p class="note">วันนี้ไม่มีเรื่องที่ต้องทบทวน</p>`;
  const recent = byNewest(entries).slice(0, 3);
  $("recent").innerHTML = recent.length
    ? recent.map(e => card(e, false)).join("")
    : `<p class="empty">ยังไม่มีบันทึก กด “เริ่มบันทึกการอ่าน” เพื่อเขียนรายการแรก ด้านล่างเป็นตัวอย่าง</p>` + card(EXAMPLE, false);
}

function renderLibrary() {
  const books = [...new Set(entries.map(e => e.book))].sort((a, b) => a.localeCompare(b, "th"));
  const sel = $("bookFilter"), keep = sel.value;
  sel.innerHTML = `<option value="">ทั้งหมด</option>` + books.map(b => `<option>${esc(b)}</option>`).join("");
  sel.value = books.includes(keep) ? keep : "";
  const q = $("q").value.trim().toLowerCase();
  const list = byNewest(entries).filter(e =>
    (!sel.value || e.book === sel.value) &&
    (!q || FIELDS.some(k => String(e[k] ?? "").toLowerCase().includes(q))));
  $("libCount").textContent = entries.length ? `${list.length} จาก ${entries.length} บันทึก` : "";
  $("entries").innerHTML = list.length ? list.map(e => card(e)).join("")
    : entries.length ? `<p class="empty">ไม่พบบันทึกที่ตรงกับคำค้น</p>` : `<p class="empty">ยังไม่มีบันทึก</p>`;
}

// ---------- เป้าหมายการอ่านรายวัน ----------
const DAY_NAMES = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const GOAL_DEFAULT = { minutes: 20, days: [0, 1, 2, 3, 4, 5, 6] };
const goalKey = () => mode === "account" ? `reading-journal-goal:${user.id}` : "reading-journal-goal";
const getGoal = () => {
  const g = lsGet(goalKey(), GOAL_DEFAULT);
  return { minutes: Math.max(1, +g.minutes || GOAL_DEFAULT.minutes), days: Array.isArray(g.days) ? g.days : GOAL_DEFAULT.days };
};
const weekdayOf = ds => new Date(ds + "T00:00:00").getDay();
const isScheduled = (ds, g = getGoal()) => g.days.includes(weekdayOf(ds));
const minutesOn = ds => entries.filter(e => e.date === ds).reduce((s, e) => s + (+e.minutes || 0), 0);
const goalMet = (mins, g = getGoal()) => mins >= g.minutes;

function describeGoal(g) {
  const days = g.days.length === 7 ? "ทุกวัน"
    : g.days.length === 0 ? "ยังไม่ได้เลือกวัน"
    : [1, 2, 3, 4, 5].every(d => g.days.includes(d)) && g.days.length === 5 ? "วันจันทร์–ศุกร์"
    : g.days.slice().sort().map(d => DAY_NAMES[d]).join(" ");
  return `เป้าหมาย: อ่านวันละ ${g.minutes} นาที · ${days}`;
}

// นับวันที่ครบเป้าติดกัน: ข้ามวันพัก (วันที่ไม่ได้ตั้งใจอ่าน) และไม่ตัดสถิติเพราะวันนี้ที่ยังไม่จบวัน
function goalStreaks() {
  const g = getGoal();
  const mins = {};
  for (const e of entries) mins[e.date] = (mins[e.date] || 0) + (+e.minutes || 0);
  const dates = Object.keys(mins).sort();
  const today = todayStr();
  if (!dates.length) return { current: 0, best: 0 };
  let run = 0, best = 0;
  for (let d = dates[0]; d <= today; d = addDays(d, 1)) {
    if (goalMet(mins[d] || 0, g)) { run++; best = Math.max(best, run); }
    else if (isScheduled(d, g) && d !== today) run = 0;
  }
  return { current: run, best };
}

function renderGoalToday() {
  const g = getGoal(), today = todayStr();
  const mins = minutesOn(today);
  const pct = Math.min(100, Math.round(mins / g.minutes * 100));
  const done = goalMet(mins, g);
  $("goalToday").classList.toggle("done", done);
  $("goalTodayChip").hidden = !done;
  $("goalTodayText").textContent = isScheduled(today, g) || mins
    ? `วันนี้อ่านแล้ว ${mins} จาก ${g.minutes} นาที`
    : "วันนี้เป็นวันพัก ไม่ได้ตั้งใจอ่านไว้";
  $("goalBarFill").style.width = pct + "%";
  $("goalBar").setAttribute("aria-valuenow", pct);
}

function openGoalForm() {
  const g = getGoal();
  $("goalMinutes").value = g.minutes;
  $("goalDays").innerHTML = DAY_NAMES.map((n, i) =>
    `<label><input type="checkbox" id="gd${i}" value="${i}" ${g.days.includes(i) ? "checked" : ""}> ${n}</label>`).join("");
  $("goalMsg").textContent = "";
  $("goalForm").hidden = false;
  $("goalEdit").hidden = true;
}
function closeGoalForm() { $("goalForm").hidden = true; $("goalEdit").hidden = false; }
$("goalEdit").addEventListener("click", openGoalForm);
$("goalCancel").addEventListener("click", closeGoalForm);
$("goalForm").addEventListener("submit", ev => {
  ev.preventDefault();
  const minutes = Math.round(+$("goalMinutes").value);
  const days = [...$("goalDays").querySelectorAll("input:checked")].map(i => +i.value);
  if (!(minutes >= 1 && minutes <= 600)) { $("goalMsg").textContent = "ใส่จำนวนนาทีระหว่าง 1 ถึง 600"; return; }
  if (!days.length) { $("goalMsg").textContent = "เลือกอย่างน้อย 1 วัน"; return; }
  lsSet(goalKey(), { minutes, days });
  if (mode === "account") { lsSet(goalPendingKey(), true); flush(); }
  closeGoalForm();
  toast("บันทึกเป้าหมายแล้ว");
  render();
});

// ---------- ปฏิทิน ----------
let calMonth = todayStr().slice(0, 7); // "YYYY-MM"
let calSelected = todayStr();

const pagesOf = e => e.pTo != null && e.pFrom != null && e.pTo >= e.pFrom ? e.pTo - e.pFrom + 1 : 0;
// ระดับสีตามเวลาที่อ่าน (นาที); บันทึกที่ไม่ได้ใส่เวลา นับเป็นระดับ 1
const levelOf = mins => mins >= 60 ? 4 : mins >= 30 ? 3 : mins >= 15 ? 2 : 1;

function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ymd(d).slice(0, 7);
}

function renderCalendar() {
  const [y, m] = calMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayStr();
  $("calTitle").textContent = first.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  $("calToday").hidden = calMonth === today.slice(0, 7);

  const byDay = {};
  for (const e of entries) {
    const d = byDay[e.date] ||= { mins: 0, pages: 0, list: [] };
    d.mins += +e.minutes || 0; d.pages += pagesOf(e); d.list.push(e);
  }
  const reviewsOn = {};
  for (const e of entries) if (e.step < INTERVALS.length && e.nextReview) (reviewsOn[e.nextReview] ||= []).push(e);

  const goal = getGoal();
  $("goalText").textContent = describeGoal(goal);

  let cells = "";
  for (let i = 0; i < first.getDay(); i++) cells += `<span></span>`;
  let mDays = 0, mPages = 0, mMins = 0, mMet = 0, mPlanned = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${calMonth}-${String(day).padStart(2, "0")}`;
    const info = byDay[ds];
    const rv = reviewsOn[ds];
    const planned = isScheduled(ds, goal);
    const met = !!info && goalMet(info.mins, goal);
    if (info) { mDays++; mPages += info.pages; mMins += info.mins; }
    if (met) mMet++;
    if (planned && ds <= today) mPlanned++;
    const cls = [info ? "lv" + levelOf(info.mins) : "", ds === today ? "today" : "", ds === calSelected ? "sel" : "",
      ds > today ? "future" : "", !planned && !info ? "off" : "", met ? "met" : "", rv ? "review" : ""].filter(Boolean).join(" ");
    const label = `${day} ${first.toLocaleDateString("th-TH", { month: "long" })}` +
      (info ? ` อ่าน ${info.list.length} บันทึก${info.mins ? " " + info.mins + " นาที" : ""}` : planned ? " ไม่ได้อ่าน" : " วันพัก") +
      (met ? " ครบเป้า" : "") + (rv ? ` นัดทบทวน ${rv.length} เรื่อง` : "");
    cells += `<button class="${cls}" data-day="${ds}" aria-label="${esc(label)}" ${ds === calSelected ? 'aria-pressed="true"' : ""}>${day}${met ? '<span class="tick" aria-hidden="true">✓</span>' : ""}</button>`;
  }
  $("calGrid").innerHTML = cells;
  $("cGoal").textContent = `${mMet}/${mPlanned}`;
  $("cDays").textContent = mDays;
  $("cPages").textContent = mPages.toLocaleString("th-TH");
  $("cMin").textContent = mMins.toLocaleString("th-TH");

  // รายละเอียดวันที่เลือก
  const sel = byDay[calSelected];
  const rv = reviewsOn[calSelected] || [];
  const longDate = new Date(calSelected + "T00:00:00").toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  let html = `<h2>${esc(longDate)}</h2>`;
  if (calSelected <= today) {
    const mins = sel?.mins || 0;
    html += goalMet(mins, goal)
      ? `<p><span class="chip">✓ ครบเป้า</span> อ่าน ${mins} นาที (เป้าหมาย ${goal.minutes} นาที)</p>`
      : isScheduled(calSelected, goal) || mins
        ? `<p class="note">อ่าน ${mins} จาก ${goal.minutes} นาที${mins ? ` · ขาดอีก ${goal.minutes - mins} นาที` : ""}</p>`
        : `<p class="note">วันพัก</p>`;
  }
  if (rv.length) {
    html += `<div class="day-review"><p class="lbl">นัดทบทวน</p>${rv.map(e =>
      `<p>${esc(e.book)} ${esc(e.chapter || "")}${calSelected <= today ? ` <button class="small" data-review="${e.id}">ทบทวน</button>` : ""}</p>`).join("")}</div>`;
  }
  const isToday = calSelected === today;
  html += sel ? byNewest(sel.list).map(e => card(e)).join("")
    : `<p class="empty">${calSelected > today ? "ยังไม่ถึงวันนั้น" : isToday ? "วันนี้ยังไม่ได้บันทึกการอ่าน" : "วันนั้นไม่ได้บันทึกการอ่าน"}</p>`;
  if (calSelected <= today) html += `<button class="primary" data-write-date="${calSelected}">${isToday ? "+ บันทึกการอ่านวันนี้" : "+ เพิ่มบันทึกย้อนหลังของวันนั้น"}</button>`;
  $("calDay").innerHTML = html;
}

$("calPrev").addEventListener("click", () => { calMonth = shiftMonth(calMonth, -1); renderCalendar(); });
$("calNext").addEventListener("click", () => { calMonth = shiftMonth(calMonth, 1); renderCalendar(); });
$("calToday").addEventListener("click", () => { calSelected = todayStr(); calMonth = calSelected.slice(0, 7); renderCalendar(); });

function renderBookList() {
  $("bookList").innerHTML = [...new Set(entries.map(e => e.book))].map(b => `<option value="${esc(b)}">`).join("");
}

function renderAccount() {
  $("accountCard").hidden = !configured;
  $("signInBtn").hidden = mode === "account";
  $("signOutBtn").hidden = mode !== "account";
  $("accountMsg").textContent = "";
  $("accountText").textContent = mode === "account"
    ? `เข้าสู่ระบบด้วย ${user.email} บันทึกจะซิงก์กับบัญชีนี้`
    : "ยังไม่ได้เข้าสู่ระบบ บันทึกเก็บในเครื่องนี้เท่านั้น";
  $("backupNote").textContent = mode === "account"
    ? "บันทึกเก็บไว้ในบัญชีแล้ว จะส่งออกไฟล์สำรองเพิ่มไว้อีกชั้นก็ได้"
    : "บันทึกทั้งหมดเก็บอยู่ในเครื่องนี้ ควรส่งออกไฟล์สำรองไว้เป็นระยะ";
}

function render() {
  if (current === "home") { renderHome(); renderGoalToday(); renderMigrate(); renderBackupNudge(); }
  if (current === "library") renderLibrary();
  if (current === "calendar") renderCalendar();
  if (current === "write") renderBookList();
  if (current === "settings") { renderNotifState(); renderAccount(); renderPersist(); $("backupMsg").textContent = lastBackupText(); }
  renderTimer();
  updateBadge();
}

// ---------- ฟอร์ม ----------
const scale = $("scale");
for (let i = 1; i <= 5; i++) {
  const l = document.createElement("label");
  l.innerHTML = `<input type="radio" name="rating" id="r${i}" value="${i}"> ${i}`;
  scale.appendChild(l);
}

function resetForm() {
  $("f").reset();
  editingId = null;
  $("date").value = todayStr();
  $("saveBtn").textContent = "บันทึก";
  $("cancelBtn").hidden = true;
}

function startEdit(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  for (const k of FIELDS) $(k).value = e[k] ?? "";
  document.querySelectorAll('input[name="rating"]').forEach(r => r.checked = +r.value === e.rating);
  $("recall").checked = !!e.recall;
  $("saveBtn").textContent = "บันทึกการแก้ไข";
  $("cancelBtn").hidden = false;
  go("write");
}

$("f").addEventListener("submit", ev => {
  ev.preventDefault();
  const prev = entries.find(x => x.id === editingId);
  const e = prev ? { ...prev } : {
    id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    created: new Date().toISOString(), step: 0
  };
  for (const k of FIELDS) {
    const v = $(k).value.trim();
    e[k] = NUMERIC.includes(k) ? (v === "" ? null : +v) : v;
  }
  const r = document.querySelector('input[name="rating"]:checked');
  e.rating = r ? +r.value : null;
  e.recall = $("recall").checked;
  if (!prev) e.nextReview = addDays(e.date, INTERVALS[0]);
  const wasMet = goalMet(minutesOn(e.date));
  if (!upsert(e)) return;
  const nowMet = goalMet(minutesOn(e.date));
  toast(!wasMet && nowMet ? `ครบเป้า ${getGoal().minutes} นาทีของ${e.date === todayStr() ? "วันนี้" : "วันนั้น"}แล้ว ✓`
    : prev ? "แก้ไขแล้ว" : "บันทึกแล้ว ทบทวนครั้งแรก " + fmt(e.nextReview));
  resetForm();
  go(prev ? "library" : "home");
});
$("cancelBtn").addEventListener("click", () => { resetForm(); go("library"); });

// ---------- โหมดทบทวน (Active Recall) ----------
function startReview(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  reviewingId = id;
  $("rvMeta").textContent = `รอบที่ ${e.step + 1} จาก ${INTERVALS.length} · อ่านเมื่อ ${fmt(e.date)}`;
  $("rvBook").textContent = e.book + (e.chapter ? " · " + e.chapter : "");
  $("rvGoal").textContent = e.goal ? "คำถามตั้งต้น: " + e.goal : "";
  $("rvAttempt").value = "";
  $("rvAnswer").innerHTML = bodyHtml(e) || `<p class="note">บันทึกนี้ไม่มีสรุป</p>`;
  $("rvAnswer").hidden = true;
  $("rvGrade").hidden = true;
  $("rvReveal").hidden = false;
  go("review");
}
$("rvReveal").addEventListener("click", () => {
  $("rvAnswer").hidden = false; $("rvGrade").hidden = false; $("rvReveal").hidden = true;
});
$("rvGrade").addEventListener("click", ev => {
  const grade = ev.target.dataset.grade;
  const e = entries.find(x => x.id === reviewingId);
  if (!grade || !e) return;
  const next = { ...e, lastReviewed: todayStr() };
  if (grade === "forgot") {
    // ลืม: เริ่มรอบใหม่ ทบทวนอีกครั้งพรุ่งนี้
    next.step = 0;
    next.nextReview = addDays(todayStr(), INTERVALS[0]);
  } else {
    next.step = e.step + 1;
    if (next.step < INTERVALS.length) {
      const gap = INTERVALS[next.step] - INTERVALS[e.step];
      next.nextReview = addDays(todayStr(), grade === "ok" ? Math.max(1, Math.round(gap / 2)) : gap);
    }
  }
  if (!upsert(next)) return;
  toast(next.step >= INTERVALS.length ? "ทบทวนครบทุกรอบแล้ว" : "รอบถัดไป " + fmt(next.nextReview));
  reviewingId = null;
  go("home");
});

// ---------- ปุ่มทั่วไป ----------
document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t) { if (pendingDelete) { pendingDelete = null; render(); } return; }
  if (t.dataset.go) { go(t.dataset.go); return; }
  if (t.dataset.day) { calSelected = t.dataset.day; pendingDelete = null; renderCalendar(); return; }
  if (t.dataset.writeDate) { resetForm(); $("date").value = t.dataset.writeDate; go("write"); return; }
  if (t.dataset.edit) { startEdit(t.dataset.edit); return; }
  if (t.dataset.review) { startReview(t.dataset.review); return; }
  if (t.dataset.del) {
    if (pendingDelete !== t.dataset.del) { pendingDelete = t.dataset.del; render(); return; }
    remove(pendingDelete);
    pendingDelete = null;
    toast("ลบแล้ว"); render();
    return;
  }
  if (pendingDelete) { pendingDelete = null; render(); }
});
$("q").addEventListener("input", renderLibrary);
$("bookFilter").addEventListener("change", renderLibrary);

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, 2600);
}

// ---------- สำรองข้อมูล ----------
const LAST_BACKUP_KEY = "reading-journal-last-backup";
const BACKUP_SNOOZE_KEY = "reading-journal-backup-snooze";
const BACKUP_EVERY_DAYS = 7;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

function exportBackup() {
  const data = { app: "reading-journal", version: 2, exported: new Date().toISOString(), goal: getGoal(), entries };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reading-journal-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  lsSet(LAST_BACKUP_KEY, todayStr());
  lsDel(BACKUP_SNOOZE_KEY);
  $("backupMsg").textContent = `ส่งออก ${entries.length} บันทึกแล้ว`;
  toast(`ส่งออก ${entries.length} บันทึกแล้ว เก็บไฟล์ไว้ในที่ปลอดภัย เช่น iCloud Drive`);
  render();
}
$("exportBtn").addEventListener("click", exportBackup);
$("backupNudgeBtn").addEventListener("click", exportBackup);
$("backupNudgeLater").addEventListener("click", () => { lsSet(BACKUP_SNOOZE_KEY, addDays(todayStr(), 3)); render(); });

// เตือนสำรองข้อมูลเมื่อไม่ได้ล็อกอิน (ข้อมูลอยู่ในเครื่องเดียว)
function renderBackupNudge() {
  const last = lsGet(LAST_BACKUP_KEY, null);
  const snoozeUntil = lsGet(BACKUP_SNOOZE_KEY, null);
  const today = todayStr();
  const firstDate = entries.reduce((m, e) => (e.created || e.date + "T").slice(0, 10) < m ? (e.created || e.date + "T").slice(0, 10) : m, today);
  const since = last ? daysBetween(last, today) : daysBetween(firstDate, today);
  const due = mode !== "account" && entries.length > 0 && since >= BACKUP_EVERY_DAYS && !(snoozeUntil && today < snoozeUntil);
  $("backupNudge").hidden = !due;
  if (due) $("backupNudgeText").textContent = last
    ? `สำรองข้อมูลครั้งล่าสุดเมื่อ ${since} วันที่แล้ว บันทึกทั้งหมด ${entries.length} รายการอยู่ในเครื่องนี้เครื่องเดียว ถ้าเครื่องหายหรือล้างข้อมูลเบราว์เซอร์ บันทึกจะหายไปด้วย`
    : `ยังไม่เคยสำรองข้อมูล บันทึกทั้งหมด ${entries.length} รายการอยู่ในเครื่องนี้เครื่องเดียว ถ้าเครื่องหายหรือล้างข้อมูลเบราว์เซอร์ บันทึกจะหายไปด้วย`;
}
function lastBackupText() {
  const last = lsGet(LAST_BACKUP_KEY, null);
  if (!last) return "ยังไม่เคยส่งออกไฟล์สำรอง";
  const n = daysBetween(last, todayStr());
  return `ส่งออกไฟล์สำรองล่าสุด: ${fmt(last)}${n ? ` (${n} วันที่แล้ว)` : " (วันนี้)"}`;
}
$("importFile").addEventListener("change", async ev => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(list)) throw new Error("format");
    let added = 0;
    for (const e of list) {
      if (!e || typeof e.id !== "string" || typeof e.book !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
      if (!entries.some(x => x.id === e.id)) added++;
      upsert({ ...e, step: Number.isInteger(e.step) ? e.step : 0, nextReview: e.nextReview || addDays(e.date, 1) });
    }
    const g = data.goal;
    if (g && Number.isFinite(+g.minutes) && +g.minutes >= 1 && Array.isArray(g.days) && g.days.length) {
      lsSet(goalKey(), { minutes: Math.round(+g.minutes), days: g.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) });
      if (mode === "account") { lsSet(goalPendingKey(), true); flush(); }
    }
    render();
    $("backupMsg").textContent = `นำเข้าแล้ว เพิ่มใหม่ ${added} บันทึก${g ? " และเป้าหมายการอ่าน" : ""}`;
  } catch {
    $("backupMsg").textContent = "ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอปนี้ ลองเลือกไฟล์ .json ที่ส่งออกจากหน้านี้";
  }
});

// ---------- แจ้งเตือน + ตัวเลขบนไอคอน ----------
const canNotify = "Notification" in window && "serviceWorker" in navigator;
function renderNotifState() {
  const btn = $("notifBtn"), s = $("notifState");
  if (!canNotify) { btn.hidden = true; s.textContent = "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน บน iPhone ต้องติดตั้งลงหน้าจอโฮมก่อน"; return; }
  const p = Notification.permission;
  btn.hidden = p !== "default";
  s.textContent = p === "granted" ? "เปิดการแจ้งเตือนแล้ว" : p === "denied" ? "การแจ้งเตือนถูกปิดอยู่ เปิดได้ในการตั้งค่าของเบราว์เซอร์หรือเครื่อง" : "";
}
$("notifBtn").addEventListener("click", async () => {
  if (!canNotify) return;
  await Notification.requestPermission();
  renderNotifState();
  notifyDue(true);
});

function updateBadge() {
  const n = dueEntries().length;
  try { if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch {}
}
async function notifyDue(force = false) {
  if (!canNotify || Notification.permission !== "granted") return;
  const due = dueEntries();
  if (!due.length) return;
  let last = null;
  try { last = localStorage.getItem(NOTIFIED_KEY); } catch {}
  if (!force && last === todayStr()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("ถึงรอบทบทวนแล้ว", {
      body: due.length === 1 ? `${due[0].book} ${due[0].chapter || ""}`.trim() : `${due.length} เรื่องรอทบทวนวันนี้`,
      icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "due-review"
    });
    localStorage.setItem(NOTIFIED_KEY, todayStr());
  } catch {}
}

// ---------- ติดตั้ง ----------
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; $("installBtn").hidden = false; });
$("installBtn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null; $("installBtn").hidden = true;
});
if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) $("installCard").hidden = true;

// ---------- ตัวจับเวลาอ่าน ----------
// เก็บเป็นเวลาเริ่ม + เวลาสะสม จึงนับต่อได้แม้ปิดหน้าจอหรือปิดแอป
const TIMER_KEY = "reading-journal-timer";
const getTimer = () => lsGet(TIMER_KEY, { acc: 0, start: null });
const timerMs = (t = getTimer()) => t.acc + (t.start ? Date.now() - t.start : 0);
const fmtTimer = ms => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
let timerTick = null, resetArmed = null;

function renderTimer() {
  const t = getTimer(), ms = timerMs(t), running = !!t.start, idle = !running && ms === 0;
  const text = fmtTimer(ms);
  $("timerTime").textContent = text;
  $("timerMiniTime").textContent = text;
  $("timerCard").classList.toggle("running", running);
  $("timerStart").hidden = running;
  $("timerStart").textContent = idle ? "เริ่มจับเวลา" : "อ่านต่อ";
  $("timerPause").hidden = !running;
  $("timerFinish").hidden = idle;
  $("timerReset").hidden = running || idle;
  if (!resetArmed) $("timerReset").textContent = "ล้างเวลา";
  $("timerState").textContent = running ? "กำลังอ่าน… ปิดหน้าจอได้ เวลายังนับต่อ"
    : idle ? "จับเวลาตอนอ่าน แล้วแอปจะใส่นาทีให้เอง" : "หยุดชั่วคราว";
  const showMini = running && current !== "write" && current !== "login";
  $("timerMini").hidden = !showMini;
  document.body.classList.toggle("timing", showMini);
  $("homeTimer").textContent = running ? `⏱ ${text} กำลังอ่าน` : idle ? "⏱ เริ่มจับเวลาอ่าน" : `⏱ ${text} หยุดอยู่`;
  clearInterval(timerTick);
  timerTick = running ? setInterval(renderTimer, 1000) : null;
}
function timerStart() {
  const t = getTimer();
  if (!t.start) { t.start = Date.now(); lsSet(TIMER_KEY, t); }
  renderTimer();
}
$("timerStart").addEventListener("click", timerStart);
$("timerPause").addEventListener("click", () => {
  const t = getTimer();
  if (t.start) lsSet(TIMER_KEY, { acc: timerMs(t), start: null });
  renderTimer();
});
$("timerFinish").addEventListener("click", () => {
  const mins = Math.max(1, Math.round(timerMs() / 60000));
  $("minutes").value = (+$("minutes").value || 0) + mins;
  lsDel(TIMER_KEY);
  renderTimer();
  toast(`ใส่เวลา ${mins} นาทีแล้ว เขียนสรุปต่อได้เลย`);
  $("minutes").scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});
$("timerReset").addEventListener("click", () => {
  if (!resetArmed) {
    $("timerReset").textContent = "แตะอีกครั้งเพื่อล้าง";
    resetArmed = setTimeout(() => { resetArmed = null; renderTimer(); }, 3000);
    return;
  }
  clearTimeout(resetArmed); resetArmed = null;
  lsDel(TIMER_KEY);
  renderTimer();
});
$("homeTimer").addEventListener("click", () => {
  if (!getTimer().start && timerMs() === 0) timerStart();
  go("write");
});

// ---------- พื้นที่เก็บข้อมูลถาวร ----------
// ขอให้เบราว์เซอร์ไม่ลบข้อมูลของแอปเองเมื่อพื้นที่เหลือน้อยหรือไม่ได้เปิดนาน
let persisted = null;
async function ensurePersist() {
  try {
    if (!navigator.storage?.persist) return;
    persisted = await navigator.storage.persisted() || await navigator.storage.persist();
  } catch { persisted = null; }
  if (current === "settings") renderPersist();
}
function renderPersist() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("persistState").textContent = persisted === true
    ? "เครื่องนี้เก็บข้อมูลของแอปแบบถาวรแล้ว"
    : standalone
      ? "เบราว์เซอร์ยังไม่ยืนยันการเก็บข้อมูลถาวร ควรล็อกอินหรือส่งออกไฟล์สำรองไว้"
      : "ถ้ายังไม่ได้ติดตั้งลงหน้าจอโฮม เบราว์เซอร์อาจลบข้อมูลเมื่อไม่ได้เปิดนาน ควรติดตั้งแอปหรือล็อกอิน";
}

// ---------- เริ่มต้น ----------
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || current === "login") return;
  render(); notifyDue(); pull();
});
window.addEventListener("storage", e => { if (e.key === cacheKey()) { entries = load(); render(); } });
window.addEventListener("online", () => pull());
window.addEventListener("offline", setSync);

async function start() {
  resetForm();
  const wantsWrite = location.hash === "#write";
  if (!configured) { enterGuest(); }
  else if (!sb) {
    // โหลดไลบรารีไม่ได้ (เช่น ออฟไลน์ครั้งแรก) ใช้ข้อมูลในเครื่องของผู้ใช้ล่าสุดไปก่อน
    const last = lsGet(LAST_USER_KEY, null);
    if (last) enterAccount(last); else enterGuest();
  } else {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        if (session?.user && user?.id !== session.user.id) enterAccount(session.user);
        document.body.classList.add("auth");
        go("login");
        $("authCard").hidden = true;
        $("recoveryForm").hidden = false;
      } else if (event === "SIGNED_IN" && session?.user && user?.id !== session.user.id) {
        enterAccount(session.user);
      } else if (event === "SIGNED_OUT" && mode === "account") {
        showLogin();
      }
    });
    const { data } = await sb.auth.getSession();
    const u = data?.session?.user;
    if (u) { if (user?.id !== u.id) enterAccount(u); }
    else if (lsGet(GUEST_CHOSEN_KEY, false)) enterGuest();
    else showLogin();
  }
  if (wantsWrite && current !== "login") go("write");
  notifyDue();
  ensurePersist();
}
start();
