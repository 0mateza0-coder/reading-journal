// ค่าจาก Supabase → Project Settings → API Keys
// - supabaseUrl: "Project URL"
// - supabaseAnonKey: "Publishable key" (sb_publishable_...) หรือคีย์ "anon public" แบบเดิม
//   ใส่ในเว็บได้อย่างปลอดภัย เพราะทุกตารางป้องกันด้วย Row Level Security
// ห้ามใส่ "Secret key" (sb_secret_...) หรือ "service_role" ในไฟล์นี้เด็ดขาด
// ถ้าเว้นว่างไว้ แอปจะทำงานแบบเก็บข้อมูลในเครื่องเท่านั้น (ไม่มีหน้าล็อกอิน)
window.APP_CONFIG = {
  supabaseUrl: "https://gnabeborwwfcwyztohvz.supabase.co",
  supabaseAnonKey: "sb_publishable__QkzS5coe4_BdcE3hPZEZg_rQpzi8OJ"
};
