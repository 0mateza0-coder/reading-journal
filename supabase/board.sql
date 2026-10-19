-- เว็บบอร์ดรีวิวหนังสือ
-- วิธีใช้: รัน schema.sql ก่อน แล้ว Supabase → SQL Editor → New query → วางทั้งไฟล์นี้ → Run (รันซ้ำได้)
--
-- สิทธิ์โดยสรุป
-- - ทุกคน (รวมถึงคนที่ไม่ได้ล็อกอิน) อ่านรีวิวและความคิดเห็นได้
-- - ต้องล็อกอินจึงจะเขียนรีวิว แสดงความคิดเห็น หรือรายงานได้
-- - แก้ไข/ลบได้เฉพาะของตัวเอง ผู้ดูแล (ตาราง admins) ลบของทุกคนได้

-- ชื่อที่แสดงบนเว็บบอร์ด
create table if not exists public.profiles (
  id           uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text        not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now()
);

-- ผู้ดูแลเว็บบอร์ด เพิ่มได้จาก SQL Editor เท่านั้น:
--   insert into public.admins (user_id) values ('<user id จาก Authentication → Users>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create table if not exists public.reviews (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
  category    text        not null check (category in ('textbook','novel','selfhelp','business','history','science','comic','other')),
  rating      smallint    not null check (rating between 1 and 5),
  book_title  text        not null check (char_length(btrim(book_title)) between 1 and 200),
  book_author text        not null default '' check (char_length(book_author) <= 200),
  title       text        not null check (char_length(btrim(title)) between 1 and 200),
  body        text        not null check (char_length(btrim(body)) between 30 and 10000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists reviews_created_idx  on public.reviews (created_at desc);
create index if not exists reviews_category_idx on public.reviews (category, created_at desc);

create table if not exists public.comments (
  id         uuid        primary key default gen_random_uuid(),
  review_id  uuid        not null references public.reviews (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_review_idx on public.comments (review_id, created_at);

create table if not exists public.reports (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  target_type text        not null check (target_type in ('review','comment')),
  target_id   uuid        not null,
  reason      text        not null default '' check (char_length(reason) <= 500),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.admins   enable row level security;
alter table public.reviews  enable row level security;
alter table public.comments enable row level security;
alter table public.reports  enable row level security;

-- profiles
drop policy if exists "profiles readable"   on public.profiles;
drop policy if exists "insert own profile"  on public.profiles;
drop policy if exists "update own profile"  on public.profiles;
create policy "profiles readable"  on public.profiles for select using (true);
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- admins: ผู้ใช้เห็นได้แค่ว่าตัวเองเป็นผู้ดูแลหรือไม่
drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row" on public.admins for select using (user_id = auth.uid());

-- reviews
drop policy if exists "reviews readable"   on public.reviews;
drop policy if exists "insert own review"  on public.reviews;
drop policy if exists "update own review"  on public.reviews;
drop policy if exists "delete own review"  on public.reviews;
create policy "reviews readable"  on public.reviews for select using (true);
create policy "insert own review" on public.reviews for insert with check (auth.uid() = user_id);
create policy "update own review" on public.reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own review" on public.reviews for delete using (auth.uid() = user_id or public.is_admin());

-- comments (ไม่มีการแก้ไข มีแต่ลบ)
drop policy if exists "comments readable"  on public.comments;
drop policy if exists "insert own comment" on public.comments;
drop policy if exists "delete own comment" on public.comments;
create policy "comments readable"  on public.comments for select using (true);
create policy "insert own comment" on public.comments for insert with check (auth.uid() = user_id);
create policy "delete own comment" on public.comments for delete using (auth.uid() = user_id or public.is_admin());

-- reports: ใครล็อกอินก็รายงานได้ ผู้ดูแลเท่านั้นที่อ่านได้
drop policy if exists "insert own report"   on public.reports;
drop policy if exists "admins read reports" on public.reports;
drop policy if exists "admins delete reports" on public.reports;
create policy "insert own report"     on public.reports for insert with check (auth.uid() = user_id);
create policy "admins read reports"   on public.reports for select using (public.is_admin());
create policy "admins delete reports" on public.reports for delete using (public.is_admin());
