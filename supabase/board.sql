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

-- ---------- รูปประกอบรีวิว (ภาพปก / รูปเล่ม) ----------
-- เก็บใน Supabase Storage บักเก็ต review-images (อ่านได้สาธารณะ) ไฟล์ละไม่เกิน 2 MB
-- แอปย่อรูปเป็น JPEG ด้านยาวไม่เกิน 1600px ก่อนอัปโหลด และเก็บที่ <user id>/<ชื่อไฟล์>.jpg
alter table public.reviews add column if not exists images text[] not null default '{}';
alter table public.reviews drop constraint if exists reviews_images_max;
alter table public.reviews add constraint reviews_images_max check (coalesce(array_length(images, 1), 0) <= 4);

-- รูปในรีวิวต้องอยู่ในโฟลเดอร์ของผู้เขียนรีวิวเท่านั้น
create or replace function public.check_review_images() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from unnest(new.images) p where p not like new.user_id::text || '/%' or p like '%..%') then
    raise exception 'invalid image path';
  end if;
  return new;
end $$;
drop trigger if exists reviews_check_images on public.reviews;
create trigger reviews_check_images before insert or update on public.reviews
  for each row execute function public.check_review_images();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', true, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload own review images" on storage.objects;
drop policy if exists "delete own review images" on storage.objects;
create policy "upload own review images" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own review images" on storage.objects for delete to authenticated
  using (bucket_id = 'review-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- จำกัดจำนวนโพสต์ต่อวัน (กันสแปม) ----------
-- รีวิว 10 เรื่อง และความคิดเห็น 50 ข้อความ ต่อผู้ใช้ ใน 24 ชั่วโมง (ผู้ดูแลไม่ถูกจำกัด)
create or replace function public.enforce_post_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'reviews' then
    select count(*) into n from public.reviews where user_id = new.user_id and created_at > now() - interval '24 hours';
    if n >= 10 then raise exception 'rate_limit: reviews per day'; end if;
  else
    select count(*) into n from public.comments where user_id = new.user_id and created_at > now() - interval '24 hours';
    if n >= 50 then raise exception 'rate_limit: comments per day'; end if;
  end if;
  return new;
end $$;
drop trigger if exists reviews_rate_limit on public.reviews;
create trigger reviews_rate_limit before insert on public.reviews for each row execute function public.enforce_post_limits();
drop trigger if exists comments_rate_limit on public.comments;
create trigger comments_rate_limit before insert on public.comments for each row execute function public.enforce_post_limits();
