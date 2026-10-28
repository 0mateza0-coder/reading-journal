-- ปิดคำเตือนจาก Security Advisor (รันซ้ำได้ ไม่แก้ข้อมูล)
-- 1) กำหนด search_path ให้ฟังก์ชันที่ยังไม่มี
alter function public.check_review_images() set search_path = public;
alter function public.stamp_times() set search_path = public;
-- 2) ฟังก์ชันของ trigger: ไม่ต้องให้ใครเรียกตรง ๆ ผ่าน API (trigger ยังทำงานตามปกติ)
revoke execute on function public.limit_entries_per_user(), public.enforce_post_limits(),
  public.limit_reports(), public.check_review_images(), public.stamp_times() from public, anon, authenticated;
-- 3) is_admin: ผู้ไม่ล็อกอินไม่ต้องใช้
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
-- 4) ลบบัญชี: เฉพาะผู้ล็อกอิน
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
