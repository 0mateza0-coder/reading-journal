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
