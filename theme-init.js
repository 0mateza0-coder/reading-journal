// ใส่ธีมก่อนหน้าเว็บแสดงผล จะได้ไม่กะพริบเป็นสีอื่นก่อน (ค่าเริ่มต้น: สว่าง)
// แยกเป็นไฟล์ (ไม่ใช้สคริปต์แบบฝังในหน้า) เพื่อให้ Content-Security-Policy บล็อกสคริปต์ฝังได้ทั้งหมด
try {
  var t = localStorage.getItem("reading-journal-theme");
  if (t === "dark" || t === "system") document.documentElement.dataset.theme = t;
} catch (e) {}
