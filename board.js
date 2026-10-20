"use strict";
// เว็บบอร์ดรีวิวหนังสือ: อ่านได้ทุกคน เขียนรีวิว/ความคิดเห็นต้องล็อกอิน
// ใช้ตัวแปรและฟังก์ชันจาก app.js: sb, mode, user, entries, $, esc, toast, go, current, showLogin

// CATEGORIES และ catLabel อยู่ใน app.js (ใช้ร่วมกับชั้นหนังสือ)
const BOARD_PAGE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_FIELDS = "id,title,book_title,book_author,category,rating,body,images,created_at,user_id,profiles(display_name),comments(count)";

// ---------- รูปภาพ (Supabase Storage) ----------
const IMG_BUCKET = "review-images";
const IMG_MAX = 4, IMG_SIDE = 1600, IMG_BYTES = 2 * 1024 * 1024;
const imgUrl = path => sb.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
// ย่อรูปบนเครื่องก่อนอัปโหลด: ด้านยาวไม่เกิน 1600px แปลงเป็น JPEG ให้ไฟล์ไม่เกิน 2 MB
async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("type");
  if (file.size > 25 * 1024 * 1024) throw new Error("big");
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    const k = Math.min(1, IMG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // รูปโปร่งใส (PNG) จะได้พื้นขาว ไม่ใช่พื้นดำ
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.55]) {
      const blob = await new Promise(ok => cv.toBlob(ok, "image/jpeg", q));
      if (blob && blob.size <= IMG_BYTES) return blob;
    }
    throw new Error("big");
  } catch (err) {
    throw err?.message === "big" || err?.message === "type" ? err : new Error("decode");
  } finally { URL.revokeObjectURL(src); }
}

const board = { cat: "", sort: "new", q: "", items: [], done: false, loading: false, req: 0, fetchedAt: 0, key: null };
const compose = { ready: false, editing: null, images: [] }; // images: [{ path } | { blob, preview }]
let myProfile = null; // { uid, name, admin }
let openPostId = null;
const armed = {};     // ปุ่มที่ต้องแตะสองครั้ง (ลบ/รายงาน)

const signedIn = () => !!sb && mode === "account" && !!user;
const nameOf = r => r?.profiles?.display_name || "ผู้ใช้";
const starText = n => "★".repeat(n) + "☆".repeat(5 - n);
function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "เมื่อสักครู่";
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}
function boardError(err) {
  const m = (err?.message || "").toLowerCase();
  if (m.includes("fetch") || m.includes("network") || !navigator.onLine) return "เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
  if (m.includes("row-level security") || err?.code === "42501") return "ไม่มีสิทธิ์ทำรายการนี้ ลองออกจากระบบแล้วเข้าใหม่";
  if (err?.code === "42P01" || m.includes("does not exist")) return "ยังไม่ได้สร้างตารางเว็บบอร์ด ผู้ดูแลต้องรัน supabase/board.sql ก่อน";
  if (m.includes("rate_limit")) return m.includes("comments") ? "วันนี้แสดงความคิดเห็นครบ 50 ข้อความแล้ว ลองใหม่พรุ่งนี้" : "วันนี้โพสต์รีวิวครบ 10 เรื่องแล้ว ลองใหม่พรุ่งนี้";
  return "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";
}
// กดสองครั้งเพื่อยืนยัน: ครั้งแรกเปลี่ยนข้อความปุ่ม ครั้งที่สองคืนค่า true
function confirmTap(btn, key, label) {
  if (armed[key]) { clearTimeout(armed[key]); delete armed[key]; return true; }
  const orig = btn.textContent;
  btn.textContent = label;
  armed[key] = setTimeout(() => { delete armed[key]; btn.textContent = orig; }, 3000);
  return false;
}

// ---------- โปรไฟล์ (ชื่อที่แสดง) ----------
async function loadProfile() {
  if (!signedIn()) { myProfile = null; return null; }
  if (myProfile?.uid === user.id) return myProfile;
  const uid = user.id;
  const [p, a] = await Promise.all([
    sb.from("profiles").select("display_name").eq("id", uid).maybeSingle(),
    sb.from("admins").select("user_id").eq("user_id", uid).maybeSingle()
  ]);
  if (user?.id !== uid) return null;
  myProfile = { uid, name: p.data?.display_name || "", admin: !!a.data };
  return myProfile;
}
async function saveProfileName(name) {
  name = name.trim();
  if (!name || name.length > 40) throw { message: "name" };
  const { error } = await sb.from("profiles").upsert({ id: user.id, display_name: name }, { onConflict: "id" });
  if (error) throw error;
  myProfile = { ...(myProfile || { uid: user.id, admin: false }), uid: user.id, name };
}

$("profileForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  try { await saveProfileName($("profileName").value); toast("บันทึกชื่อแล้ว"); }
  catch (err) { toast(err?.message === "name" ? "ใส่ชื่อ 1–40 ตัวอักษร" : boardError(err)); }
});

// ---------- รายการรีวิว ----------
function renderCats() {
  $("bCats").innerHTML = [["", "ทั้งหมด"], ...CATEGORIES].map(([k, l]) =>
    `<button type="button" class="cat${board.cat === k ? " on" : ""}" data-cat="${k}" aria-pressed="${board.cat === k}">${esc(l)}</button>`).join("");
}

function reviewCard(r) {
  const n = r.comments?.[0]?.count ?? 0;
  const excerpt = r.body.length > 140 ? r.body.slice(0, 140).trim() + "…" : r.body;
  const cover = r.images?.[0];
  return `<a class="entry b-card${cover ? " has-cover" : ""}" href="#post/${esc(r.id)}">
    ${cover ? `<img class="b-cover" src="${esc(imgUrl(cover))}" alt="ภาพปก ${esc(r.book_title)}" loading="lazy" decoding="async">` : ""}
    <div class="entry-head"><span class="chip">${esc(catLabel(r.category))}</span><span class="stars" aria-label="${r.rating} จาก 5 ดาว">${starText(r.rating)}</span></div>
    <h3>${esc(r.title)}</h3>
    <p class="book">📖 ${esc(r.book_title)}${r.book_author ? ` · ${esc(r.book_author)}` : ""}</p>
    <p class="excerpt">${esc(excerpt)}</p>
    <p class="meta">${esc(nameOf(r))} · ${esc(relTime(r.created_at))} · 💬 ${n}</p>
  </a>`;
}

function renderList() {
  $("bList").innerHTML = board.items.map(reviewCard).join("");
  $("bMore").hidden = board.done || !board.items.length;
  if (!board.loading && !board.items.length && $("bState").dataset.kind !== "error") {
    $("bState").textContent = board.q || board.cat ? "ไม่พบรีวิวที่ตรงกับที่ค้นหา" : "ยังไม่มีรีวิว เป็นคนแรกที่เขียนรีวิวได้เลย";
  }
}

async function fetchList(reset) {
  if (!sb) {
    $("bState").textContent = "เว็บบอร์ดยังใช้ไม่ได้ ต้องเชื่อมต่อฐานข้อมูลออนไลน์ (Supabase) ก่อน ดูขั้นตอนใน README";
    $("bNew").hidden = true; $("bList").innerHTML = ""; $("bMore").hidden = true;
    return;
  }
  if (reset) { board.items = []; board.done = false; }
  const req = ++board.req;
  board.loading = true;
  $("bState").dataset.kind = "";
  $("bState").textContent = "กำลังโหลด…";
  let q = sb.from("reviews").select(LIST_FIELDS);
  if (board.cat) q = q.eq("category", board.cat);
  const term = board.q.replace(/[,()%*\\:]/g, " ").trim();
  if (term) q = q.or(`title.ilike.%${term}%,book_title.ilike.%${term}%,book_author.ilike.%${term}%`);
  q = board.sort === "top"
    ? q.order("rating", { ascending: false }).order("created_at", { ascending: false })
    : q.order("created_at", { ascending: false });
  const from = board.items.length;
  const { data, error } = await q.range(from, from + BOARD_PAGE - 1);
  if (req !== board.req) return; // มีคำขอใหม่กว่าแล้ว
  board.loading = false;
  if (error) {
    $("bState").dataset.kind = "error";
    $("bState").textContent = boardError(error);
    renderList();
    return;
  }
  board.items.push(...data);
  board.done = data.length < BOARD_PAGE;
  board.fetchedAt = Date.now();
  board.key = `${board.cat}|${board.sort}|${board.q}`;
  $("bState").textContent = "";
  renderList();
}

$("bCats").addEventListener("click", ev => {
  const b = ev.target.closest("[data-cat]");
  if (!b) return;
  board.cat = b.dataset.cat;
  renderCats();
  fetchList(true);
});
$("bSort").addEventListener("change", () => { board.sort = $("bSort").value; fetchList(true); });
let searchTimer;
$("bSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { board.q = $("bSearch").value.trim(); fetchList(true); }, 350);
});
$("bMore").addEventListener("click", () => fetchList(false));
$("bNew").addEventListener("click", () => {
  if (!signedIn()) { showLogin("compose"); return; }
  startCompose(null);
});

// ---------- อ่านรีวิว ----------
let postData = null;

async function openPost(id) {
  if (!UUID_RE.test(id)) return;
  openPostId = id;
  document.body.classList.remove("auth");
  go("post");
  $("pArticle").innerHTML = `<p class="note">กำลังโหลดรีวิว…</p>`;
  $("pActions").innerHTML = ""; $("pComments").innerHTML = "";
  if (!sb) { $("pArticle").innerHTML = `<p class="note">เว็บบอร์ดยังใช้ไม่ได้ ต้องเชื่อมต่อฐานข้อมูลออนไลน์ก่อน</p>`; renderCommentForm(); return; }
  const { data, error } = await sb.from("reviews").select("*, profiles(display_name)").eq("id", id).maybeSingle();
  if (openPostId !== id) return;
  if (error || !data) {
    postData = null;
    $("pArticle").innerHTML = `<p class="note">${error ? esc(boardError(error)) : "ไม่พบรีวิวนี้ อาจถูกลบไปแล้ว"}</p>`;
    renderCommentForm();
    return;
  }
  postData = data;
  await loadProfile().catch(() => null);
  renderPost();
  loadComments(id);
}

function renderPost() {
  const r = postData;
  if (!r) return;
  const edited = new Date(r.updated_at) - new Date(r.created_at) > 60000;
  $("pArticle").innerHTML = `
    <div class="entry-head"><span class="chip">${esc(catLabel(r.category))}</span><span class="stars big-stars" aria-label="${r.rating} จาก 5 ดาว">${starText(r.rating)}</span></div>
    <h2 class="post-title">${esc(r.title)}</h2>
    <p class="book">📖 ${esc(r.book_title)}${r.book_author ? ` · ${esc(r.book_author)}` : ""}</p>
    <p class="meta">โดย ${esc(nameOf(r))} · ${esc(relTime(r.created_at))}${edited ? " · แก้ไขแล้ว" : ""}</p>
    ${r.images?.length ? `<div class="gallery n${r.images.length}">${r.images.map((p, i) =>
      `<button type="button" class="g-img" data-zoom="${esc(imgUrl(p))}" aria-label="ดูรูปที่ ${i + 1} ขนาดใหญ่"><img src="${esc(imgUrl(p))}" alt="รูปประกอบรีวิว ${esc(r.book_title)} ${i + 1}" loading="lazy" decoding="async"></button>`).join("")}</div>` : ""}
    <div class="post-body">${esc(r.body)}</div>`;
  const mine = signedIn() && r.user_id === user.id;
  const admin = !!myProfile?.admin;
  $("pActions").innerHTML = [
    `<button class="small" data-share>แชร์ลิงก์</button>`,
    mine ? `<button class="small" data-edit-post>แก้ไข</button>` : "",
    mine || admin ? `<button class="small" data-del-post>ลบรีวิว</button>` : "",
    signedIn() && !mine ? `<button class="small" data-report="review:${esc(r.id)}">รายงาน</button>` : ""
  ].join("");
  renderCommentForm();
}

function renderCommentForm() {
  const can = signedIn() && !!postData;
  $("pCommentForm").hidden = !can;
  $("pLoginPrompt").hidden = !sb || signedIn() || !postData;
  $("pNameWrap").hidden = !can || !!myProfile?.name;
}

async function loadComments(id) {
  $("pComments").innerHTML = `<p class="note">กำลังโหลดความคิดเห็น…</p>`;
  const { data, error } = await sb.from("comments").select("id,body,created_at,user_id,profiles(display_name)")
    .eq("review_id", id).order("created_at", { ascending: true }).limit(300);
  if (openPostId !== id) return;
  if (error) { $("pComments").innerHTML = `<p class="note">${esc(boardError(error))}</p>`; return; }
  $("pCommentsTitle").textContent = `ความคิดเห็น (${data.length})`;
  const admin = !!myProfile?.admin;
  $("pComments").innerHTML = data.length ? data.map(c => {
    const mine = signedIn() && c.user_id === user.id;
    return `<div class="comment">
      <p class="meta"><b>${esc(nameOf(c))}</b> · ${esc(relTime(c.created_at))}</p>
      <p class="comment-body">${esc(c.body)}</p>
      <div class="entry-actions">
        ${mine || admin ? `<button class="small" data-del-comment="${esc(c.id)}">ลบ</button>` : ""}
        ${signedIn() && !mine ? `<button class="small" data-report="comment:${esc(c.id)}">รายงาน</button>` : ""}
      </div></div>`;
  }).join("") : `<p class="empty">ยังไม่มีความคิดเห็น</p>`;
}

$("pCommentForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const body = $("pCommentBody").value.trim();
  const msg = t => { $("pCommentMsg").textContent = t; };
  if (!body) { msg("พิมพ์ความคิดเห็นก่อนส่ง"); return; }
  if (!postData) return;
  const btn = $("pCommentSend");
  btn.disabled = true; msg("");
  try {
    if (!myProfile?.name) {
      if (!$("pName").value.trim()) { msg("ตั้งชื่อที่แสดงก่อน"); return; }
      await saveProfileName($("pName").value);
    }
    const { error } = await sb.from("comments").insert({ review_id: postData.id, body });
    if (error) throw error;
    $("pCommentBody").value = "";
    renderCommentForm();
    toast("ส่งความคิดเห็นแล้ว");
    loadComments(postData.id);
  } catch (err) {
    msg(err?.message === "name" ? "ใส่ชื่อ 1–40 ตัวอักษร" : boardError(err));
  } finally { btn.disabled = false; }
});

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button");
  if (!t) return;
  if (t.hasAttribute("data-board-login")) { showLogin("post"); return; }
  if (t.hasAttribute("data-share") && postData) {
    const url = `${location.origin}${location.pathname}#post/${postData.id}`;
    try {
      if (navigator.share) await navigator.share({ title: postData.title, url });
      else { await navigator.clipboard.writeText(url); toast("คัดลอกลิงก์แล้ว"); }
    } catch (err) { if (err?.name !== "AbortError") toast("คัดลอกลิงก์ไม่ได้: " + url); }
    return;
  }
  if (t.hasAttribute("data-edit-post") && postData) { startCompose(postData); return; }
  if (t.hasAttribute("data-del-post") && postData) {
    if (!confirmTap(t, "post", "แตะอีกครั้งเพื่อลบ")) return;
    const { error } = await sb.from("reviews").delete().eq("id", postData.id);
    if (error) { toast(boardError(error)); return; }
    if (postData.images?.length) sb.storage.from(IMG_BUCKET).remove(postData.images).catch(() => {});
    toast("ลบรีวิวแล้ว");
    postData = null; openPostId = null;
    board.fetchedAt = 0;
    go("board");
    return;
  }
  if (t.dataset.delComment) {
    if (!confirmTap(t, "c" + t.dataset.delComment, "แตะอีกครั้งเพื่อลบ")) return;
    const { error } = await sb.from("comments").delete().eq("id", t.dataset.delComment);
    if (error) { toast(boardError(error)); return; }
    toast("ลบความคิดเห็นแล้ว");
    if (postData) loadComments(postData.id);
    return;
  }
  if (t.dataset.report) {
    const [type, id] = t.dataset.report.split(":");
    if (!confirmTap(t, "r" + id, "แตะอีกครั้งเพื่อรายงาน")) return;
    const { error } = await sb.from("reports").insert({ target_type: type, target_id: id, reason: "ไม่เหมาะสม" });
    if (error) { toast(boardError(error)); return; }
    t.disabled = true; t.textContent = "รายงานแล้ว";
    toast("ส่งรายงานให้ผู้ดูแลแล้ว ขอบคุณครับ");
  }
});

// ---------- เขียน/แก้ไขรีวิว ----------
function startCompose(review) {
  compose.editing = review;
  $("cCat").innerHTML = `<option value="">เลือกหมวดหมู่</option>` + CATEGORIES.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  $("cStars").innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<label><input type="radio" name="cRating" id="cR${n}" value="${n}"><span aria-hidden="true">★</span><span class="sr">${n} ดาว</span></label>`).join("");
  const books = [...new Set(entries.map(e => e.book).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  $("cFrom").innerHTML = `<option value="">ไม่ใช้</option>` + books.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
  $("cFromWrap").hidden = !!review || !books.length;
  $("cBook").value = review?.book_title || "";
  $("cAuthor").value = review?.book_author || "";
  $("cCat").value = review?.category || "";
  $("cTitle").value = review?.title || "";
  $("cBody").value = review?.body || "";
  if (review) $("cR" + review.rating).checked = true;
  clearComposeImages();
  compose.images = (review?.images || []).map(path => ({ path }));
  renderComposeImages();
  $("cMsg").textContent = "";
  $("cNameWrap").hidden = !!myProfile?.name;
  $("cSubmit").textContent = review ? "บันทึกการแก้ไข" : "โพสต์รีวิว";
  updateCount();
  compose.ready = true;
  go("compose");
  $("viewTitle").textContent = review ? "แก้ไขรีวิว" : "เขียนรีวิว";
  updateStars();
  loadProfile().then(p => { if (current === "compose") $("cNameWrap").hidden = !!p?.name; }).catch(() => {});
}

function updateCount() { $("cCount").textContent = $("cBody").value.length.toLocaleString("th-TH"); }
function updateStars() {
  const v = +(document.querySelector('input[name="cRating"]:checked')?.value || 0);
  $("cStars").querySelectorAll("label").forEach((l, i) => l.classList.toggle("lit", i < v));
}
$("cBody").addEventListener("input", updateCount);
$("cStars").addEventListener("change", updateStars);

// เติมข้อมูลจากบันทึกการอ่านของตัวเอง
$("cFrom").addEventListener("change", () => {
  const book = $("cFrom").value;
  if (!book) return;
  $("cBook").value = book;
  const mine = entries.filter(e => e.book === book).sort((a, b) => a.date.localeCompare(b.date));
  const text = mine.map(e => {
    const pts = [e.k1, e.k2, e.k3].filter(Boolean).map(p => `• ${p}`).join("\n");
    return [e.chapter ? `[${e.chapter}]` : "", pts, e.summary, e.apply ? `นำไปใช้: ${e.apply}` : ""].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
  if (text) $("cBody").value = $("cBody").value.trim() ? `${$("cBody").value.trim()}\n\n${text}` : text;
  const best = mine.map(e => e.rating).filter(Boolean);
  if (best.length && !document.querySelector('input[name="cRating"]:checked')) {
    $("cR" + Math.round(best.reduce((a, b) => a + b, 0) / best.length)).checked = true;
    updateStars();
  }
  updateCount();
  toast("เติมสรุปจากบันทึกแล้ว แก้ไขให้เป็นรีวิวก่อนโพสต์ได้");
});

$("cForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = t => { $("cMsg").textContent = t; };
  const v = {
    book_title: $("cBook").value.trim(),
    book_author: $("cAuthor").value.trim(),
    category: $("cCat").value,
    rating: +(document.querySelector('input[name="cRating"]:checked')?.value || 0),
    title: $("cTitle").value.trim(),
    body: $("cBody").value.trim()
  };
  if (!signedIn()) { showLogin("compose"); return; }
  if (!v.book_title) return msg("ใส่ชื่อหนังสือ");
  if (!CATEGORIES.some(c => c[0] === v.category)) return msg("เลือกหมวดหมู่");
  if (!(v.rating >= 1 && v.rating <= 5)) return msg("ให้คะแนน 1–5 ดาว");
  if (!v.title) return msg("ใส่หัวข้อรีวิว");
  if (v.body.length < 30) return msg(`เนื้อหารีวิวต้องมีอย่างน้อย 30 ตัวอักษร (ตอนนี้ ${v.body.length})`);
  const btn = $("cSubmit");
  btn.disabled = true; msg("");
  try {
    if (!myProfile?.name) {
      if (!$("cName").value.trim()) { msg("ตั้งชื่อที่แสดงก่อน"); return; }
      await saveProfileName($("cName").value);
    }
    // อัปโหลดรูปใหม่ก่อน แล้วค่อยบันทึกรีวิว ถ้าบันทึกไม่สำเร็จ ลบรูปที่เพิ่งอัปโหลดทิ้ง
    const uploaded = [];
    let id;
    try {
      for (const im of compose.images) {
        if (im.path) continue;
        msg(`กำลังอัปโหลดรูป ${uploaded.length + 1}/${compose.images.filter(x => !x.path).length}…`);
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(IMG_BUCKET).upload(path, im.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
        if (error) throw error;
        im.path = path; uploaded.push(path);
      }
      msg("");
      v.images = compose.images.map(im => im.path);
      if (compose.editing) {
        id = compose.editing.id;
        const { error } = await sb.from("reviews").update({ ...v, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
        const removed = (compose.editing.images || []).filter(p => !v.images.includes(p));
        if (removed.length) sb.storage.from(IMG_BUCKET).remove(removed).catch(() => {});
      } else {
        const { data, error } = await sb.from("reviews").insert(v).select("id").single();
        if (error) throw error;
        id = data.id;
      }
    } catch (err) {
      if (uploaded.length) {
        sb.storage.from(IMG_BUCKET).remove(uploaded).catch(() => {});
        for (const im of compose.images) if (uploaded.includes(im.path)) delete im.path;
      }
      throw err;
    }
    clearComposeImages();
    toast(compose.editing ? "บันทึกการแก้ไขแล้ว" : "โพสต์รีวิวแล้ว");
    compose.ready = false; compose.editing = null;
    $("cForm").reset();
    board.fetchedAt = 0;
    if (location.hash === `#post/${id}`) openPost(id); else location.hash = `#post/${id}`;
  } catch (err) {
    msg(err?.message === "name" ? "ใส่ชื่อ 1–40 ตัวอักษร" : boardError(err));
  } finally { btn.disabled = false; }
});
$("cCancel").addEventListener("click", () => {
  const back = compose.editing?.id;
  clearComposeImages();
  compose.ready = false; compose.editing = null;
  $("cForm").reset();
  if (back) openPost(back); else go("board");
});

// ---------- เลือกรูป + ดูรูปขนาดใหญ่ ----------
function clearComposeImages() {
  for (const im of compose.images) if (im.preview) URL.revokeObjectURL(im.preview);
  compose.images = [];
  $("cImgMsg").textContent = "";
}
function renderComposeImages() {
  $("cImages").innerHTML = compose.images.map((im, i) => `
    <div class="img-tile${i === 0 ? " is-cover" : ""}">
      <img src="${esc(im.preview || imgUrl(im.path))}" alt="รูปที่ ${i + 1}">
      ${i === 0 ? `<span class="img-badge">ภาพปก</span>` : `<button type="button" class="img-act" data-img-cover="${i}">ใช้เป็นปก</button>`}
      <button type="button" class="img-del" data-img-del="${i}" aria-label="ลบรูปที่ ${i + 1}">✕</button>
    </div>`).join("");
  $("cImgAdd").hidden = compose.images.length >= IMG_MAX;
}
$("cImgInput").addEventListener("change", async ev => {
  const files = [...ev.target.files];
  ev.target.value = "";
  const room = IMG_MAX - compose.images.length;
  if (files.length > room) $("cImgMsg").textContent = `เพิ่มได้อีก ${room} รูป (สูงสุด ${IMG_MAX} รูปต่อรีวิว)`;
  else $("cImgMsg").textContent = "";
  for (const f of files.slice(0, room)) {
    try {
      const blob = await compressImage(f);
      compose.images.push({ blob, preview: URL.createObjectURL(blob) });
      renderComposeImages();
    } catch (err) {
      $("cImgMsg").textContent = err.message === "type" ? `“${f.name}” ไม่ใช่ไฟล์รูปภาพ`
        : err.message === "big" ? `“${f.name}” ใหญ่เกินไป ลองเลือกรูปที่เล็กลง`
        : `เปิดรูป “${f.name}” ไม่ได้ ลองบันทึกเป็น JPG หรือ PNG แล้วเลือกใหม่`;
    }
  }
});
$("cImages").addEventListener("click", ev => {
  const del = ev.target.closest("[data-img-del]"), cov = ev.target.closest("[data-img-cover]");
  if (del) {
    const [im] = compose.images.splice(+del.dataset.imgDel, 1);
    if (im?.preview) URL.revokeObjectURL(im.preview);
  } else if (cov) {
    const [im] = compose.images.splice(+cov.dataset.imgCover, 1);
    compose.images.unshift(im);
  } else return;
  $("cImgMsg").textContent = "";
  renderComposeImages();
});
function openLightbox(src, alt) {
  $("lbImg").src = src; $("lbImg").alt = alt || "";
  $("lightbox").hidden = false;
  $("lbClose").focus();
}
function closeLightbox() { $("lightbox").hidden = true; $("lbImg").removeAttribute("src"); }
$("pArticle").addEventListener("click", ev => {
  const b = ev.target.closest("[data-zoom]");
  if (b) openLightbox(b.dataset.zoom, b.querySelector("img")?.alt);
});
$("lightbox").addEventListener("click", ev => { if (ev.target !== $("lbImg")) closeLightbox(); });
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !$("lightbox").hidden) closeLightbox(); });

// ---------- เชื่อมกับ app.js ----------
function onBoardRender(view) {
  // ออกจากหน้ารีวิวแล้ว ไม่ต้องค้างลิงก์ #post/... ไว้
  if (view !== "post" && location.hash.startsWith("#post/")) history.replaceState(null, "", location.pathname + location.search);
  if (view !== "post") openPostId = null;
  if (mode !== "account") myProfile = null;
  if (view === "board") {
    renderCats();
    $("bNew").hidden = !sb;
    $("bNew").textContent = signedIn() ? "+ เขียนรีวิวหนังสือ" : "+ เข้าสู่ระบบเพื่อเขียนรีวิว";
    const key = `${board.cat}|${board.sort}|${board.q}`;
    if (!sb || board.key !== key || Date.now() - board.fetchedAt > 15000) fetchList(true);
    else renderList();
  }
  if (view === "post" && postData && openPostId === postData.id) renderCommentForm();
  if (view === "compose" && !compose.ready) {
    if (signedIn()) startCompose(null); else go("board");
  }
  if (view === "settings") {
    $("profileForm").hidden = !signedIn();
    if (signedIn()) loadProfile().then(p => { if (p && current === "settings" && document.activeElement !== $("profileName")) $("profileName").value = p.name; }).catch(() => {});
  }
}

function routeHash() {
  const m = location.hash.match(/^#post\/([0-9a-f-]{36})$/i);
  if (m && m[1] !== openPostId) openPost(m[1]);
}
window.addEventListener("hashchange", routeHash);
function onAppReady() { routeHash(); }
// ถ้าแอปไม่ได้เชื่อม Supabase app.js จะเริ่มเสร็จก่อนไฟล์นี้โหลด จึงต้องตรวจลิงก์ที่นี่เอง
if (!configured) routeHash();
