"use strict";
// แนะนำการใช้งานครั้งแรก + เคล็ดลับครั้งแรกของแต่ละหน้า
// ใช้จาก app.js / shelf.js: entries, getBooks, upsertBook, newBook, findBook, lsGet, lsSet, markSettingsDirty, goalKey,
// timerStart, resetForm, go, current, toast, searchOpenLibrary, searchGoogleBooks, canNotify, renderNotifState

const GUIDE_DONE_KEY = "reading-journal-guide-done";
const GUIDE_TIPS_KEY = "reading-journal-tips-seen";
const GUIDE_MINUTES = [10, 15, 20, 30, 45, 60];
const guide = { step: 1, book: null, minutes: 20, days: "all", checked: false, hitList: [], timer: null };

const GUIDE_TIPS = {
  write: ["บันทึกให้ได้ผล", "กดจับเวลาก่อนอ่าน พออ่านเสร็จให้ปิดหนังสือ แล้วเขียนประเด็นสำคัญจากความจำ การนึกเองช่วยให้จำได้นานกว่าการอ่านซ้ำ"],
  review: ["ทำไมต้องทบทวน", "ลองนึกประเด็นสำคัญให้ได้ก่อน แล้วค่อยกดดูสรุป ถ้าลืมเกือบหมด แอปจะนัดทบทวนใหม่พรุ่งนี้ ถ้าจำได้ดี รอบถัดไปจะห่างออกไปเรื่อย ๆ (1 → 3 → 7 → 30 วัน)"],
  calendar: ["อ่านปฏิทินยังไง", "สียิ่งเข้มแปลว่าวันนั้นอ่านนาน ✓ สีทองคือวันที่ครบเป้า จุดสีส้มคือวันที่มีนัดทบทวน แตะวันไหนก็ได้เพื่อดูหรือเพิ่มบันทึกย้อนหลัง"],
  library: ["ชั้นหนังสือ", "หนังสือที่บันทึกจะขึ้นชั้น “กำลังอ่าน” เอง ใส่จำนวนหน้าทั้งเล่มเพื่อดูความคืบหน้าและวันที่น่าจะอ่านจบ เล่มที่อยากอ่านเก็บไว้ในกองดองได้"],
  stats: ["หน้าสถิติ", "สลับดูรายเดือนหรือรายปีได้ด้านบน แตะแท่งกราฟหรือชิ้นโดนัทเพื่อดูตัวเลข ตั้งเป้าจำนวนเล่มและจำนวนหน้าต่อปีได้ที่ “แก้เป้าหมาย” ในมุมมองรายปี"],
  board: ["เว็บบอร์ดรีวิว", "อ่านรีวิวจากคนอื่นได้เลย ถ้าอยากเขียนรีวิวหรือแสดงความคิดเห็นต้องเข้าสู่ระบบ ดึงสรุปจากบันทึกของตัวเองมาเป็นรีวิวได้"]
};

// ---------- แนะนำครั้งแรก ----------
function showGuideStep(n) {
  guide.step = n;
  document.querySelectorAll("#wCard .w-step").forEach(el => { el.hidden = +el.dataset.step !== n; });
  document.querySelectorAll("#wCard .w-dots i").forEach((d, i) => d.classList.toggle("on", i < n));
  if (n === 3) renderGuideMinutes();
  if (n === 4) renderGuideNotif();
  const focusEl = document.querySelector(`#wCard .w-step[data-step="${n}"] input, #wCard .w-step[data-step="${n}"] button`);
  focusEl?.focus({ preventScroll: true });
}

function startGuide() {
  guide.step = 1; guide.book = null; guide.checked = true;
  const g = getGoal();
  guide.minutes = g.minutes;
  guide.days = g.days.length === 5 && [1, 2, 3, 4, 5].every(d => g.days.includes(d)) ? "weekdays" : "all";
  $("wBook").value = ""; $("wHits").innerHTML = ""; $("wPicked").hidden = true;
  document.body.classList.add("onboard");
  go("welcome");
  showGuideStep(1);
}

function finishGuide(how) {
  lsSet(GUIDE_DONE_KEY, true);
  document.body.classList.remove("onboard");
  // บันทึกเล่มที่กำลังอ่าน
  let title = guide.book?.title || $("wBook").value.trim();
  if (how !== "skip" && title) {
    const ex = findBook(title);
    if (!ex) upsertBook(newBook({ title, author: guide.book?.author || "", totalPages: guide.book?.pages || null, cover: guide.book?.cover || null, status: "reading", startedAt: todayStr() }));
    else if (ex.status === "want") upsertBook({ ...ex, status: "reading", startedAt: ex.startedAt || todayStr() });
  }
  if (how !== "skip") {
    lsSet(goalKey(), { minutes: guide.minutes, days: guide.days === "weekdays" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6] });
    markSettingsDirty();
  }
  if (how === "timer") {
    resetForm();
    if (title) $("book").value = title;
    timerStart();
    go("write");
    toast("เริ่มจับเวลาแล้ว อ่านเสร็จกด “จบการอ่าน · ใส่เวลา”");
  } else {
    go("home");
    if (how === "home") toast("ตั้งค่าเรียบร้อย กด ⏱ เริ่มจับเวลาอ่าน เมื่อพร้อม");
  }
}

// ค้นหาชื่อหนังสือในขั้นที่ 1 (ใช้ฟังก์ชันค้นหาจาก shelf.js)
$("wBook").addEventListener("input", () => {
  clearTimeout(guide.timer);
  guide.book = null; $("wPicked").hidden = true;
  const q = $("wBook").value.trim();
  if (q.length < 3) { $("wHits").innerHTML = ""; return; }
  guide.timer = setTimeout(async () => {
    $("wHits").innerHTML = `<p class="note">กำลังค้นหา…</p>`;
    const [ol, gb] = await Promise.all([searchOpenLibrary(q), searchGoogleBooks(q)]);
    if ($("wBook").value.trim() !== q) return;
    guide.hitList = [...gb, ...ol].filter(h => h.title).slice(0, 4);
    $("wHits").innerHTML = guide.hitList.map((h, i) => `
      <button type="button" class="hit" data-w-hit="${i}">
        ${h.cover ? `<img src="${esc(h.cover)}" alt="" loading="lazy">` : `<span class="hit-nocover" aria-hidden="true">📖</span>`}
        <span class="hit-main"><b>${esc(h.title)}</b><span class="meta">${esc([h.author, h.pages ? `${h.pages} หน้า` : ""].filter(Boolean).join(" · "))}</span></span>
      </button>`).join("") || `<p class="note">ไม่พบในฐานข้อมูล ไม่เป็นไร ใช้ชื่อที่พิมพ์ไว้ได้เลย</p>`;
  }, 500);
});

$("view-welcome").addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t) return;
  if (t.hasAttribute("data-w-next")) { showGuideStep(Math.min(4, guide.step + 1)); return; }
  if (t.hasAttribute("data-w-skipbook")) { $("wBook").value = ""; guide.book = null; showGuideStep(3); return; }
  if (t.dataset.wHit) {
    guide.book = guide.hitList[+t.dataset.wHit];
    $("wBook").value = guide.book.title;
    $("wHits").innerHTML = "";
    $("wPicked").hidden = false;
    $("wPicked").innerHTML = `${guide.book.cover ? `<img src="${esc(guide.book.cover)}" alt="">` : ""}<span>✓ <b>${esc(guide.book.title)}</b>${guide.book.author ? `<br><span class="meta">${esc(guide.book.author)}</span>` : ""}</span>`;
    return;
  }
  if (t.dataset.wMin) { guide.minutes = +t.dataset.wMin; renderGuideMinutes(); return; }
  if (t.dataset.days) {
    guide.days = t.dataset.days;
    document.querySelectorAll("#wDays [data-days]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.days === guide.days)));
    return;
  }
  if (t.dataset.wFinish) { finishGuide(t.dataset.wFinish); return; }
});

function renderGuideMinutes() {
  $("wMinutes").innerHTML = GUIDE_MINUTES.map(m =>
    `<button type="button" role="radio" aria-checked="${m === guide.minutes}" class="${m === guide.minutes ? "on" : ""}" data-w-min="${m}">${m}<small>นาที</small></button>`).join("");
  document.querySelectorAll("#wDays [data-days]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.days === guide.days)));
}

function renderGuideNotif() {
  const supported = "Notification" in window && "serviceWorker" in navigator;
  const p = supported ? Notification.permission : "unsupported";
  $("wNotif").hidden = p !== "default";
  $("wNotifNote").textContent = p === "granted" ? "✓ เปิดการแจ้งเตือนแล้ว"
    : p === "denied" ? "การแจ้งเตือนถูกปิดไว้ เปิดได้ในการตั้งค่าของเบราว์เซอร์ภายหลัง"
    : p === "unsupported" ? "เครื่องนี้ยังแจ้งเตือนไม่ได้ บน iPhone ต้องติดตั้งแอปลงหน้าจอโฮมก่อน"
    : "แอปจะแจ้งเตือนเมื่อมีเรื่องที่ต้องทบทวน และเมื่อครบรอบ Pomodoro";
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("wInstall").textContent = standalone ? "" : "💡 ติดตั้งลงหน้าจอโฮมจะใช้ได้เหมือนแอป: iPhone เปิดใน Safari → ปุ่มแชร์ → “เพิ่มไปยังหน้าจอโฮม”";
}
$("wNotif").addEventListener("click", async () => {
  try { await Notification.requestPermission(); } catch {}
  renderGuideNotif();
});

$("replayGuide").addEventListener("click", startGuide);
$("resetTips").addEventListener("click", () => { lsSet(GUIDE_TIPS_KEY, []); toast("จะแสดงเคล็ดลับในแต่ละหน้าอีกครั้ง"); });

// ---------- เคล็ดลับครั้งแรกของแต่ละหน้า ----------
function renderTip(view) {
  document.querySelectorAll(".tip").forEach(el => el.remove());
  const tip = GUIDE_TIPS[view];
  if (!tip || !lsGet(GUIDE_DONE_KEY, false)) return;
  if (lsGet(GUIDE_TIPS_KEY, []).includes(view)) return;
  const sec = $("view-" + view);
  if (!sec) return;
  const el = document.createElement("aside");
  el.className = "tip";
  el.setAttribute("role", "note");
  el.innerHTML = `<p><b>💡 ${esc(tip[0])}</b><br>${esc(tip[1])}</p><button type="button" class="small" data-tip-ok="${view}">เข้าใจแล้ว</button>`;
  sec.prepend(el);
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-tip-ok]");
  if (!b) return;
  const seen = lsGet(GUIDE_TIPS_KEY, []);
  if (!seen.includes(b.dataset.tipOk)) lsSet(GUIDE_TIPS_KEY, [...seen, b.dataset.tipOk]);
  b.closest(".tip")?.remove();
});

// ---------- เชื่อมกับ app.js ----------
function onGuideRender(view) {
  if (view !== "welcome") document.body.classList.remove("onboard");
  // ผู้ใช้ใหม่ (ยังไม่มีบันทึกหรือหนังสือ): พาเข้าหน้าแนะนำครั้งเดียว
  if (!guide.checked && view === "home") {
    guide.checked = true;
    if (!lsGet(GUIDE_DONE_KEY, false) && !entries.length && !getBooks().length) { startGuide(); return; }
    if (!lsGet(GUIDE_DONE_KEY, false)) lsSet(GUIDE_DONE_KEY, true); // ผู้ใช้เดิม ไม่ต้องแนะนำ
  }
  renderTip(view);
}
