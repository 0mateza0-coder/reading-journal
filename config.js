// ค่าจาก Supabase → Project Settings → API
// - supabaseUrl: "Project URL"
// - supabaseAnonKey: คีย์ "anon public" (ใส่ในเว็บได้ เพราะตารางป้องกันด้วย Row Level Security)
// ห้ามใส่คีย์ "service_role" ในไฟล์นี้เด็ดขาด
// ถ้าเว้นว่างไว้ แอปจะทำงานแบบเก็บข้อมูลในเครื่องเท่านั้น (ไม่มีหน้าล็อกอิน)
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: ""
};
