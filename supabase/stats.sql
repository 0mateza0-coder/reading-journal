-- สถิติการใช้งานแอป (อ่านอย่างเดียว ไม่แก้ข้อมูล)
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ผลลัพธ์แสดงเฉพาะตัวเลขรวม ไม่แสดงอีเมลหรือเนื้อหาบันทึกของใคร

-- 1) รายวัน 14 วันล่าสุด (สมัครใหม่ / คนที่เขียนบันทึก / จำนวนบันทึกที่เขียนหรือแก้)
-- SQL Editor แสดงผลของคำสั่งสุดท้าย: กด Run ทั้งไฟล์จะเห็นภาพรวม (ข้อ 2)
-- ถ้าอยากดูตารางรายวัน ให้ลากคลุมเฉพาะส่วนนี้แล้วกด Run
select d::date                                                                          as "วันที่",
  (select count(*) from auth.users u
     where (u.created_at at time zone 'Asia/Bangkok')::date = d::date)                 as "สมัครใหม่",
  (select count(distinct e.user_id) from public.entries e
     where (e.updated_at at time zone 'Asia/Bangkok')::date = d::date)                 as "คนที่เขียนบันทึก",
  (select count(*) from public.entries e
     where (e.updated_at at time zone 'Asia/Bangkok')::date = d::date)                 as "บันทึก"
from generate_series((now() at time zone 'Asia/Bangkok')::date - 13,
                     (now() at time zone 'Asia/Bangkok')::date, interval '1 day') as d
order by d desc;

-- 2) ภาพรวม
select
  (select count(*) from auth.users)                                                    as "ผู้ใช้ทั้งหมด",
  (select count(*) from auth.users where email_confirmed_at is not null)               as "ยืนยันอีเมลแล้ว",
  (select count(distinct user_id) from auth.identities where provider = 'google')      as "ใช้ Google",
  (select count(*) from auth.users where created_at > now() - interval '7 days')        as "สมัครใหม่ 7 วัน",
  (select count(distinct user_id) from public.entries
     where updated_at > now() - interval '7 days')                                     as "คนที่เขียนบันทึก 7 วัน",
  (select count(distinct user_id) from public.entries)                                 as "คนที่เคยเขียนบันทึก",
  (select count(*) from public.entries)                                                as "บันทึกทั้งหมด",
  (select coalesce(sum(case when data->>'minutes' ~ '^\d+(\.\d+)?$'
                            then (data->>'minutes')::numeric end), 0) from public.entries) as "นาทีอ่านรวม",
  (select count(*) from public.profiles)                                               as "ตั้งโปรไฟล์แล้ว",
  (select count(*) from public.reviews)                                                as "รีวิว",
  (select count(*) from public.comments)                                               as "ความคิดเห็น",
  (select count(*) from public.reports)                                                as "รายงานจากผู้ใช้";
