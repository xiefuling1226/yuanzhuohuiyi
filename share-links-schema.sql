-- Supabase：圆桌对话分享短链接（与前端 CONFIG.supabaseUrl / supabaseKey 对应项目内执行一次）
-- 执行后在 Table Editor 中确认 roundtable_share_links 存在，且 anon 具备 insert/select（公开分享读写）

create table if not exists public.roundtable_share_links (
  slug text primary key,
  frag text not null,
  created_at timestamptz not null default now()
);

create index if not exists roundtable_share_links_created_at_idx
  on public.roundtable_share_links (created_at desc);

alter table public.roundtable_share_links enable row level security;

drop policy if exists "roundtable_share_links_anon_insert" on public.roundtable_share_links;
drop policy if exists "roundtable_share_links_anon_select" on public.roundtable_share_links;

create policy "roundtable_share_links_anon_insert"
  on public.roundtable_share_links for insert
  to anon
  with check (true);

create policy "roundtable_share_links_anon_select"
  on public.roundtable_share_links for select
  to anon
  using (true);
