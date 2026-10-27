"use strict";
// หน้าโปรไฟล์ + ปุ่มโปรไฟล์มุมขวาบน + ระดับนักอ่าน
// ใช้จาก app.js / board.js: mode, user, entries, getBooks, goalStreaks, pagesOf, lsGet, lsSet, toast, go, current,
// sb, signedIn, loadProfile, saveMyProfile, myProfile, showLogin, esc, fmt

// ระดับนักอ่าน: [เลข, ชื่อ, คะแนนขั้นต่ำ, สัญลักษณ์]
const READER_LEVELS = [
  [1, "นักอ่านฝึกหัด", 0, "🌱"],
  [2, "หนอนหนังสือน้อย", 150, "🐛"],
  [3, "นักอ่านขยัน", 500, "📖"],
  [4, "นักอ่านตัวยง", 1200, "📚"],
  [5, "หนอนหนังสือ", 2500, "🦉"],
  [6, "ปราชญ์แห่งชั้นหนังสือ", 5000, "🎓"],
  [7, "บรรณารักษ์ในตำนาน", 10000, "👑"]
];
// วิธีได้คะแนน
const XP_RULES = { minute: 1, book: 30, summary: 5, review: 3 };
const AVATARS = ["📚", "🦉", "🐛", "🦊", "🐱", "🐼", "🐻", "🐰", "🌱", "🌙", "⭐", "☕", "🎧", "🌸", "🍵", "✏️"];
const avatarSafe = v => AVATARS.includes(v) ? v : "";
const LEVEL_SEEN_KEY = () => mode === "account" && user ? `reading-journal-level-seen:${user.id}` : "reading-journal-level-seen";
let pfAvatarPick = "";
let pfLevelSyncing = false;

function readerXp() {
  const minutes = entries.reduce((s, e) => s + (+e.minutes || 0), 0);
  const books = getBooks().filter(b => b.status === "done").length;
  const summaries = entries.filter(e => (e.summary || "").trim() || (e.k1 || "").trim()).length;
  const reviews = entries.reduce((s, e) => s + (Number.isInteger(e.step) ? e.step : 0), 0);
  const parts = {
    minute: minutes * XP_RULES.minute, book: books * XP_RULES.book,
    summary: summaries * XP_RULES.summary, review: reviews * XP_RULES.review
  };
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts, counts: { minutes, books, summaries, reviews } };
}
function levelOfXp(xp) {
  let cur = READER_LEVELS[0];
  for (const L of READER_LEVELS) if (xp >= L[2]) cur = L;
  const next = READER_LEVELS.find(L => L[2] > xp) || null;
  return { level: cur[0], name: cur[1], icon: cur[3], min: cur[2], next };
}

// ---------- ปุ่มโปรไฟล์มุมขวาบน ----------
function faceFor(p) {
  const av = avatarSafe(p?.avatar);
  if (av) return esc(av);
  const base = (p?.name || user?.email || "").trim();
  return base ? esc(base[0].toUpperCase()) : "";
}
function renderProfileButton() {
  const btn = $("profileBtn"), face = $("profileBtnFace");
  if (signedIn()) {
    const f = faceFor(myProfile);
    if (f && face.dataset.face !== f) { face.innerHTML = `<span class="face">${f}</span>`; face.dataset.face = f; }
    btn.classList.add("signed-in");
    $("profileDot").hidden = false;
    btn.setAttribute("aria-label", `โปรไฟล์ของ ${myProfile?.name || user.email} (เข้าสู่ระบบแล้ว)`);
    btn.title = `เข้าสู่ระบบแล้ว: ${user.email}`;
  } else {
    if (face.dataset.face) {
      face.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/></svg>`;
      delete face.dataset.face;
    }
    btn.classList.remove("signed-in");
    $("profileDot").hidden = true;
    btn.setAttribute("aria-label", "โปรไฟล์ (ยังไม่ได้เข้าสู่ระบบ)");
    btn.title = "ยังไม่ได้เข้าสู่ระบบ";
  }
}

// ---------- หน้าโปรไฟล์ ----------
function renderProfilePage() {
  const me = signedIn() ? myProfile : null;
  const xp = readerXp(), lv = levelOfXp(xp.total);

  $("pfAvatar").innerHTML = signedIn() ? (faceFor(me) || "🙂") : "👤";
  $("pfName").textContent = signedIn() ? (me?.name || "ยังไม่ได้ตั้งชื่อ") : "ผู้ใช้ทั่วไป";
  $("pfEmail").textContent = signedIn()
    ? [user.email, user.createdAt ? `สมาชิกตั้งแต่ ${fmt(String(user.createdAt).slice(0, 10))}` : ""].filter(Boolean).join(" · ")
    : "ไม่ได้เข้าสู่ระบบ";
  $("pfStatus").textContent = signedIn() ? `● เข้าสู่ระบบแล้ว · ${$("syncState").textContent || "ซิงก์แล้ว"}` : "○ ใช้งานในเครื่องนี้เท่านั้น";
  $("pfStatus").className = signedIn() ? "chip" : "chip quiet";
  $("pfForm").hidden = !signedIn();
  $("pfGuest").hidden = signedIn();
  $("pfSignOut").hidden = !signedIn();
  if (signedIn()) {
    if (document.activeElement !== $("pfNameInput")) $("pfNameInput").value = me?.name || "";
    if (!pfAvatarPick) pfAvatarPick = avatarSafe(me?.avatar);
    $("pfAvatars").innerHTML = AVATARS.map(a =>
      `<button type="button" role="radio" aria-checked="${a === pfAvatarPick}" class="${a === pfAvatarPick ? "on" : ""}" data-avatar="${a}" aria-label="รูป ${a}">${a}</button>`).join("");
  }

  // ระดับนักอ่าน
  const span = lv.next ? lv.next[2] - lv.min : 1;
  const pct = lv.next ? Math.min(100, Math.round((xp.total - lv.min) / span * 100)) : 100;
  $("pfLevel").innerHTML = `
    <div class="lv-head">
      <span class="lv-badge" aria-hidden="true">${lv.icon}</span>
      <div><p class="w-eyebrow">ระดับนักอ่าน</p><h2>Lv.${lv.level} ${esc(lv.name)}</h2></div>
      <p class="lv-xp"><b>${xp.total.toLocaleString("th-TH")}</b><span>คะแนน</span></p>
    </div>
    <div class="bar lv-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="ความคืบหน้าไประดับถัดไป"><span style="width:${pct}%"></span></div>
    <p class="meta">${lv.next ? `อีก ${(lv.next[2] - xp.total).toLocaleString("th-TH")} คะแนน จะได้เป็น Lv.${lv.next[0]} ${esc(lv.next[1])} ${lv.next[3]}` : "ถึงระดับสูงสุดแล้ว ยอดเยี่ยมมาก!"}</p>
    <ul class="xp-list">
      <li><span>⏱ อ่าน ${xp.counts.minutes.toLocaleString("th-TH")} นาที</span><b>+${xp.parts.minute.toLocaleString("th-TH")}</b><small>นาทีละ ${XP_RULES.minute}</small></li>
      <li><span>✓ อ่านจบ ${xp.counts.books} เล่ม</span><b>+${xp.parts.book.toLocaleString("th-TH")}</b><small>เล่มละ ${XP_RULES.book}</small></li>
      <li><span>✍️ เขียนสรุป ${xp.counts.summaries} ครั้ง</span><b>+${xp.parts.summary.toLocaleString("th-TH")}</b><small>ครั้งละ ${XP_RULES.summary}</small></li>
      <li><span>🔁 ทบทวน ${xp.counts.reviews} รอบ</span><b>+${xp.parts.review.toLocaleString("th-TH")}</b><small>รอบละ ${XP_RULES.review}</small></li>
    </ul>`;

  const streak = goalStreaks();
  const pages = entries.reduce((s, e) => s + pagesOf(e), 0);
  $("pfStats").innerHTML = `
    <div class="stat"><b>${xp.counts.books}</b><span>เล่มที่อ่านจบ</span></div>
    <div class="stat"><b>${pages.toLocaleString("th-TH")}</b><span>หน้าทั้งหมด</span></div>
    <div class="stat"><b>${(xp.counts.minutes / 60).toFixed(xp.counts.minutes >= 600 ? 0 : 1)}</b><span>ชั่วโมงอ่าน</span></div>
    <div class="stat"><b>${streak.best}</b><span>ครบเป้าติดกันสูงสุด (วัน)</span></div>`;

  $("pfLadder").innerHTML = `<h2>ระดับทั้งหมด</h2><ol class="ladder">${READER_LEVELS.map(L => `
    <li class="${L[0] < lv.level ? "done" : L[0] === lv.level ? "now" : ""}">
      <span class="ld-icon" aria-hidden="true">${L[3]}</span>
      <span class="ld-name">Lv.${L[0]} ${esc(L[1])}</span>
      <span class="ld-xp">${L[2].toLocaleString("th-TH")} คะแนน</span>
      <span class="ld-mark" aria-label="${L[0] <= lv.level ? "ผ่านแล้ว" : "ยังไม่ถึง"}">${L[0] < lv.level ? "✓" : L[0] === lv.level ? "← ตอนนี้" : ""}</span>
    </li>`).join("")}</ol>`;
}

$("pfAvatars").addEventListener("click", ev => {
  const b = ev.target.closest("[data-avatar]");
  if (!b) return;
  pfAvatarPick = avatarSafe(b.dataset.avatar);
  $("pfAvatars").querySelectorAll("[data-avatar]").forEach(x => {
    const on = x.dataset.avatar === pfAvatarPick;
    x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on));
  });
  $("pfAvatar").textContent = pfAvatarPick;
});
$("pfForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const name = $("pfNameInput").value.trim();
  if (!name) { $("pfMsg").textContent = "ตั้งชื่อที่แสดงก่อน (1–40 ตัวอักษร)"; return; }
  $("pfSave").disabled = true; $("pfMsg").textContent = "";
  try {
    await saveMyProfile({ name, avatar: pfAvatarPick, level: levelOfXp(readerXp().total).level });
    toast("บันทึกโปรไฟล์แล้ว");
    renderProfileButton(); renderProfilePage();
  } catch (err) {
    $("pfMsg").textContent = err?.message === "name" ? "ชื่อต้องยาว 1–40 ตัวอักษร" : boardError(err);
  } finally { $("pfSave").disabled = false; }
});
$("pfLogin").addEventListener("click", () => showLogin("profile"));
$("pfSignOut").addEventListener("click", () => $("signOutBtn").click());

// เลื่อนระดับ: แจ้งเมื่อระดับสูงขึ้น และบันทึกระดับขึ้นโปรไฟล์เว็บบอร์ด
function checkLevel() {
  const lv = levelOfXp(readerXp().total);
  const seen = lsGet(LEVEL_SEEN_KEY(), null);
  if (seen === null) lsSet(LEVEL_SEEN_KEY(), lv.level);
  else if (lv.level > seen) {
    lsSet(LEVEL_SEEN_KEY(), lv.level);
    toast(`🎉 เลื่อนระดับเป็น Lv.${lv.level} ${lv.name} ${lv.icon}`);
  }
  if (signedIn() && myProfile?.uid === user.id && myProfile.name && myProfile.level !== lv.level && !pfLevelSyncing) {
    pfLevelSyncing = true;
    saveMyProfile({ level: lv.level }).catch(() => {}).finally(() => { pfLevelSyncing = false; });
  }
}

// ---------- เชื่อมกับ app.js ----------
let pfLastUser = null, pfLoading = false;
function onProfileRender(view) {
  const uid = signedIn() ? user.id : null;
  if (uid !== pfLastUser) { pfLastUser = uid; pfAvatarPick = ""; }
  renderProfileButton();
  if (view !== "login" && view !== "welcome") checkLevel();
  if (view === "profile") renderProfilePage();
  // โหลดโปรไฟล์จากเว็บบอร์ด (ครั้งแรก) แล้ววาดปุ่ม/หน้าใหม่
  if (signedIn() && myProfile?.uid !== user.id && !pfLoading) {
    pfLoading = true;
    loadProfile().then(() => { renderProfileButton(); if (current === "profile") renderProfilePage(); checkLevel(); })
      .catch(() => {}).finally(() => { pfLoading = false; });
  }
}
