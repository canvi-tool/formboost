-- FormBoost v3.0 — Supabase Schema
-- Run this in Supabase Dashboard > SQL Editor

-- ===== Extensions =====
create extension if not exists "uuid-ossp";

-- ===== ENUM types =====
do $$ begin
  create type campaign_status as enum ('draft','searching','ready','sending','paused','done');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type send_status as enum ('pending','queued','sending','success','failed','skipped','captcha');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type log_level as enum ('debug','info','warn','error');
exception when duplicate_object then null;
end $$;

-- ===== profiles =====
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  display_name    text,
  company_name    text,
  sender_name     text,
  sender_email    text,
  sender_phone    text,
  default_template text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ===== campaigns =====
create table if not exists campaigns (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references profiles(id) on delete cascade,
  name            text not null,
  status          campaign_status not null default 'draft',
  total_targets   int not null default 0,
  searched_count  int not null default 0,
  sent_count      int not null default 0,
  success_count   int not null default 0,
  failed_count    int not null default 0,
  skipped_count   int not null default 0,
  template        text,
  sender_company  text,
  sender_name     text,
  sender_email    text,
  sender_phone    text,
  estimated_cost  numeric(12,2) not null default 0,
  actual_cost     numeric(12,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ===== targets =====
create table if not exists targets (
  id                  uuid primary key default uuid_generate_v4(),
  campaign_id         uuid not null references campaigns(id) on delete cascade,
  company             text not null,
  hp_url              text,
  form_url            text,
  hojin_number        text,
  address             text,
  site_url            text,
  search_confidence   text,
  search_source       text,
  search_mode         text,
  search_cost         numeric(8,2) not null default 0,
  send_status         send_status not null default 'pending',
  send_error          text,
  filled_fields       jsonb,
  complete_detected   boolean not null default false,
  complete_keyword    text,
  screenshot_url      text,
  final_url           text,
  page_title          text,
  elapsed_ms          int,
  sent_at             timestamptz,
  retry_count         int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ===== execution_logs =====
create table if not exists execution_logs (
  id          bigint generated always as identity primary key,
  campaign_id uuid references campaigns(id) on delete set null,
  target_id   uuid references targets(id) on delete set null,
  level       log_level not null default 'info',
  phase       text,
  message     text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

-- ===== Indexes =====
create index if not exists idx_campaigns_user_id on campaigns(user_id);
create index if not exists idx_campaigns_status on campaigns(status);
create index if not exists idx_targets_campaign_id on targets(campaign_id);
create index if not exists idx_targets_send_status on targets(send_status);
create index if not exists idx_targets_campaign_status on targets(campaign_id, send_status);
create index if not exists idx_execution_logs_campaign on execution_logs(campaign_id);
create index if not exists idx_execution_logs_target on execution_logs(target_id);
create index if not exists idx_execution_logs_created on execution_logs(created_at desc);

-- ===== Updated_at triggers =====
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
  for each row execute function update_updated_at();

drop trigger if exists trg_campaigns_updated on campaigns;
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function update_updated_at();

drop trigger if exists trg_targets_updated on targets;
create trigger trg_targets_updated before update on targets
  for each row execute function update_updated_at();

-- ===== Row Level Security =====

-- profiles
alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- campaigns
alter table campaigns enable row level security;

create policy "Users can view own campaigns"
  on campaigns for select using (auth.uid() = user_id);
create policy "Users can insert own campaigns"
  on campaigns for insert with check (auth.uid() = user_id);
create policy "Users can update own campaigns"
  on campaigns for update using (auth.uid() = user_id);
create policy "Users can delete own campaigns"
  on campaigns for delete using (auth.uid() = user_id);

-- targets (campaign owner only)
alter table targets enable row level security;

create policy "Users can view campaign targets"
  on targets for select using (
    exists (select 1 from campaigns c where c.id = targets.campaign_id and c.user_id = auth.uid())
  );
create policy "Users can insert campaign targets"
  on targets for insert with check (
    exists (select 1 from campaigns c where c.id = targets.campaign_id and c.user_id = auth.uid())
  );
create policy "Users can update campaign targets"
  on targets for update using (
    exists (select 1 from campaigns c where c.id = targets.campaign_id and c.user_id = auth.uid())
  );
create policy "Users can delete campaign targets"
  on targets for delete using (
    exists (select 1 from campaigns c where c.id = targets.campaign_id and c.user_id = auth.uid())
  );

-- execution_logs (campaign owner can view)
alter table execution_logs enable row level security;

create policy "Users can view own logs"
  on execution_logs for select using (
    campaign_id is null or
    exists (select 1 from campaigns c where c.id = execution_logs.campaign_id and c.user_id = auth.uid())
  );
create policy "Service can insert logs"
  on execution_logs for insert with check (true);

-- ===== Service role bypass (for webhook / batch) =====
-- service_role key bypasses RLS automatically

-- ===== Auto-create profile on signup =====
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ===== Increment helper (atomic counter) =====
create or replace function increment_campaign_counter(
  p_campaign_id uuid,
  p_field text,
  p_amount int default 1
) returns void as $$
begin
  execute format(
    'update campaigns set %I = %I + $1, sent_count = sent_count + $1 where id = $2',
    p_field, p_field
  ) using p_amount, p_campaign_id;
end;
$$ language plpgsql security definer;

-- ===== Enable Realtime =====
alter publication supabase_realtime add table targets;
alter publication supabase_realtime add table campaigns;
