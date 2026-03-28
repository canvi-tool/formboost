-- FormBoost v3 Database Schema
-- Run this in Supabase SQL Editor

-- ============================
-- 1. profiles (ユーザー情報)
-- ============================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  company_name text default '株式会社Canvi',
  sender_name text default '岡林優治',
  sender_email text default 'yuji.okabayashi@canvi.co.jp',
  sender_phone text default '03-6271-4900',
  default_template text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auth hookでprofile自動作成
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================
-- 2. campaigns (キャンペーン)
-- ============================
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'searching', 'ready', 'sending', 'paused', 'done')),
  total_targets int default 0,
  searched_count int default 0,
  sent_count int default 0,
  success_count int default 0,
  failed_count int default 0,
  skipped_count int default 0,
  template text default '',
  sender_company text,
  sender_name text,
  sender_email text,
  sender_phone text,
  estimated_cost numeric(10,2) default 0,
  actual_cost numeric(10,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================
-- 3. targets (送信対象企業)
-- ============================
create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  company text not null,
  hp_url text,
  form_url text,
  hojin_number text,
  address text,
  -- 検索結果
  site_url text,
  search_confidence text,
  search_source text,      -- 'direct_url' | 'hp_url' | 'search'
  search_mode text,        -- 'A' | 'B' | 'search'
  search_cost numeric(6,2) default 0,
  -- 送信状態
  send_status text default 'pending' check (send_status in ('pending', 'queued', 'sending', 'success', 'failed', 'skipped', 'captcha')),
  send_error text,
  -- 送信結果
  filled_fields jsonb,
  complete_detected boolean default false,
  complete_keyword text,
  screenshot_url text,
  final_url text,
  page_title text,
  elapsed_ms int,
  sent_at timestamptz,
  retry_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================
-- 4. execution_logs (実行ログ)
-- ============================
create table if not exists public.execution_logs (
  id bigint primary key generated always as identity,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  target_id uuid references public.targets(id) on delete cascade,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  phase text,              -- 'search' | 'send' | 'webhook' | 'retry'
  message text not null,
  metadata jsonb,
  created_at timestamptz default now()
);

-- ============================
-- 5. Indexes
-- ============================
create index if not exists idx_campaigns_user on public.campaigns(user_id);
create index if not exists idx_campaigns_status on public.campaigns(status);
create index if not exists idx_targets_campaign on public.targets(campaign_id);
create index if not exists idx_targets_send_status on public.targets(send_status);
create index if not exists idx_targets_company on public.targets(company);
create index if not exists idx_logs_campaign on public.execution_logs(campaign_id);
create index if not exists idx_logs_target on public.execution_logs(target_id);
create index if not exists idx_logs_created on public.execution_logs(created_at desc);

-- ============================
-- 6. RLS Policies
-- ============================
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.targets enable row level security;
alter table public.execution_logs enable row level security;

-- profiles: 自分のみ
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- campaigns: 自分のキャンペーンのみ
create policy "campaigns_select_own" on public.campaigns for select using (auth.uid() = user_id);
create policy "campaigns_insert_own" on public.campaigns for insert with check (auth.uid() = user_id);
create policy "campaigns_update_own" on public.campaigns for update using (auth.uid() = user_id);
create policy "campaigns_delete_own" on public.campaigns for delete using (auth.uid() = user_id);

-- targets: 自分のキャンペーンのtargetのみ
create policy "targets_select_own" on public.targets for select
  using (campaign_id in (select id from public.campaigns where user_id = auth.uid()));
create policy "targets_insert_own" on public.targets for insert
  with check (campaign_id in (select id from public.campaigns where user_id = auth.uid()));
create policy "targets_update_own" on public.targets for update
  using (campaign_id in (select id from public.campaigns where user_id = auth.uid()));
create policy "targets_delete_own" on public.targets for delete
  using (campaign_id in (select id from public.campaigns where user_id = auth.uid()));

-- execution_logs: 自分のキャンペーンのログのみ
create policy "logs_select_own" on public.execution_logs for select
  using (campaign_id in (select id from public.campaigns where user_id = auth.uid()));

-- ============================
-- 7. Service Role policies (Cloud Run webhook用)
-- ============================
-- Cloud RunはSERVICE_ROLE_KEYを使うため、RLSをバイパス可能
-- targets.send_status / send結果 の更新はwebhook APIでservice_roleを使う

-- ============================
-- 8. Realtime有効化
-- ============================
alter publication supabase_realtime add table public.targets;
alter publication supabase_realtime add table public.campaigns;

-- ============================
-- 9. Updated_at自動更新
-- ============================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.update_updated_at();
create trigger targets_updated_at before update on public.targets
  for each row execute function public.update_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at();
