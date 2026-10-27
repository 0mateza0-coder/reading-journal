-- ตารางเก็บบันทึกการอ่านของผู้ใช้แต่ละคน
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์นี้ → Run

create table if not exists public.entries (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- เปิด Row Level Security: ผู้ใช้แต่ละคนเห็นและแก้ได้เฉพาะบันทึกของตัวเอง
alter table public.entries enable row level security;

drop policy if exists "read own entries"   on public.entries;
drop policy if exists "insert own entries" on public.entries;
drop policy if exists "update own entries" on public.entries;
drop policy if exists "delete own entries" on public.entries;

create policy "read own entries"   on public.entries for select using (auth.uid() = user_id);
create policy "insert own entries" on public.entries for insert with check (auth.uid() = user_id);
create policy "update own entries" on public.entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own entries" on public.entries for delete using (auth.uid() = user_id);

-- การตั้งค่าของผู้ใช้ (เช่น เป้าหมายการอ่าน) หนึ่งแถวต่อหนึ่งคน
create table if not exists public.settings (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

drop policy if exists "read own settings"   on public.settings;
drop policy if exists "insert own settings" on public.settings;
drop policy if exists "update own settings" on public.settings;

create policy "read own settings"   on public.settings for select using (auth.uid() = user_id);
create policy "insert own settings" on public.settings for insert with check (auth.uid() = user_id);
create policy "update own settings" on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ลบบัญชีของตัวเอง (เรียกจากปุ่ม "ลบบัญชีและข้อมูลทั้งหมด" ในหน้าตั้งค่า)
-- ลบผู้ใช้ใน auth.users แล้วข้อมูลทุกตารางที่อ้างถึงจะถูกลบตาม (on delete cascade)
-- รูปใน Storage แอปจะลบเองก่อนเรียกฟังก์ชันนี้
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- จำกัดขนาดข้อมูล (กันการใช้พื้นที่เกินจำเป็น) ----------
alter table public.entries drop constraint if exists entries_id_len;
alter table public.entries add constraint entries_id_len check (char_length(id) between 1 and 64);
alter table public.entries drop constraint if exists entries_data_size;
alter table public.entries add constraint entries_data_size check (octet_length(data::text) <= 65536);
alter table public.settings drop constraint if exists settings_data_size;
alter table public.settings add constraint settings_data_size check (octet_length(data::text) <= 3000000);

-- บันทึกได้ไม่เกิน 20,000 รายการต่อคน
create or replace function public.limit_entries_per_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.entries where user_id = new.user_id) >= 20000 then
    raise exception 'limit: entries per user';
  end if;
  return new;
end $$;
drop trigger if exists entries_limit on public.entries;
create trigger entries_limit before insert on public.entries for each row execute function public.limit_entries_per_user();

-- ---------- สิทธิ์การเข้าถึงผ่าน Data API ----------
-- จำเป็นเมื่อปิด "Automatically expose new tables" ตอนสร้างโปรเจกต์ (ปลอดภัยกว่า)
-- สิทธิ์นี้แค่เปิดประตู ส่วนใครเห็น/แก้แถวไหนได้ ยังถูกคุมด้วย Row Level Security ด้านบน
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.entries to authenticated;
grant select, insert, update on public.settings to authenticated;
grant execute on function public.delete_my_account() to authenticated;
