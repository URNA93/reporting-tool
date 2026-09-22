begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.reporting_role as enum ('user', 'manager', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reporting_account_status as enum ('active', 'disabled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reporting_project_state as enum ('active', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reporting_project_phase as enum ('new', 'contact', 'analysis', 'offer', 'signature', 'processing');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reporting_appointment_type as enum ('analysis', 'consulting');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reporting_appointment_status as enum ('scheduled', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.reporting_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  position text not null default 'T' check (position in ('T','FC','FS','HFC','TM','AM','AD','RD','GD','P','GA1','GA2','GA3','GA4','GA5')),
  role public.reporting_role not null default 'user',
  status public.reporting_account_status not null default 'active',
  legacy_user_id uuid unique,
  legacy_migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_profiles_company_email check (lower(email) ~ '^[^@[:space:]]+@gfsgroup\.cz$')
);

create table if not exists public.reporting_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.reporting_profiles(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  summary text not null default '',
  sync_status text not null default 'pending' check (sync_status in ('pending','synced','failed')),
  sync_error text,
  legacy_id uuid unique,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_reports_period check (period_start <= period_end)
);

create table if not exists public.reporting_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.reporting_profiles(id) on delete restrict,
  source_report_id uuid references public.reporting_reports(id) on delete set null,
  period_start date not null,
  period_end date not null,
  root_project_id uuid references public.reporting_projects(id) on delete restrict,
  previous_project_id uuid references public.reporting_projects(id) on delete restrict,
  name text not null,
  description text not null default '',
  value numeric(16,2),
  unit text check (unit is null or unit in ('ks','BU','Kč','%')),
  state public.reporting_project_state not null default 'active',
  phase public.reporting_project_phase not null default 'new',
  due_date date,
  is_carryover boolean not null default false,
  carried_from_value numeric(16,2),
  cancellation_reason text,
  legacy_id uuid unique,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_projects_period check (period_start <= period_end),
  constraint reporting_projects_cancel_reason check (
    state <> 'cancelled' or length(trim(coalesce(cancellation_reason, ''))) >= 3
  )
);

create unique index if not exists reporting_projects_carryover_once
  on public.reporting_projects(previous_project_id, period_start, period_end)
  where previous_project_id is not null and deleted_at is null;
create index if not exists reporting_projects_owner_period_idx
  on public.reporting_projects(owner_id, period_start, period_end) where deleted_at is null;
create index if not exists reporting_projects_filters_idx
  on public.reporting_projects(period_end, state, phase, is_carryover, due_date) where deleted_at is null;

create table if not exists public.reporting_appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.reporting_profiles(id) on delete restrict,
  report_id uuid references public.reporting_reports(id) on delete set null,
  period_start date not null,
  period_end date not null,
  type public.reporting_appointment_type not null,
  client_name text not null,
  description text not null default '',
  due_date date,
  due_time time,
  status public.reporting_appointment_status not null default 'scheduled',
  note text not null default '',
  legacy_id uuid unique,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_appointments_period check (period_start <= period_end)
);

create index if not exists reporting_appointments_owner_period_idx
  on public.reporting_appointments(owner_id, period_start, period_end) where deleted_at is null;
create index if not exists reporting_appointments_due_idx
  on public.reporting_appointments(due_date, due_time) where deleted_at is null;

create table if not exists public.reporting_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  position text not null check (position in ('T','FC','FS','HFC','TM','AM','AD','RD','GD','P','GA1','GA2','GA3','GA4','GA5')),
  role public.reporting_role not null default 'user',
  revoked_at timestamptz,
  created_by uuid not null references public.reporting_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint reporting_invitations_company_email check (lower(email) ~ '^[^@[:space:]]+@gfsgroup\.cz$')
);

create or replace function public.reporting_first_tuesday(p_year integer, p_month integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select make_date(p_year, p_month, 1)
    + ((2 - extract(dow from make_date(p_year, p_month, 1))::integer + 7) % 7);
$$;

create or replace function public.reporting_period_for(p_day date)
returns table(period_start date, period_end date)
language plpgsql
stable
set search_path = ''
as $$
declare
  this_close date;
  next_month date;
  close_month date;
  previous_month date;
begin
  this_close := public.reporting_first_tuesday(extract(year from p_day)::integer, extract(month from p_day)::integer);
  if p_day > this_close then
    next_month := (date_trunc('month', p_day)::date + interval '1 month')::date;
    close_month := next_month;
  else
    close_month := date_trunc('month', p_day)::date;
  end if;
  previous_month := (close_month - interval '1 month')::date;
  period_end := public.reporting_first_tuesday(extract(year from close_month)::integer, extract(month from close_month)::integer);
  period_start := public.reporting_first_tuesday(extract(year from previous_month)::integer, extract(month from previous_month)::integer) + 1;
  return next;
end;
$$;

create or replace function public.reporting_current_role()
returns public.reporting_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role from public.reporting_profiles where id = auth.uid() and status = 'active'), 'user'::public.reporting_role);
$$;

create or replace function public.reporting_is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reporting_profiles
    where id = auth.uid() and status = 'active' and role in ('manager','admin')
  );
$$;

create or replace function public.reporting_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reporting_profiles
    where id = auth.uid() and status = 'active' and role = 'admin'
  );
$$;

create or replace function public.reporting_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_name text;
  user_position text;
  user_role public.reporting_role;
begin
  if lower(coalesce(new.email, '')) !~ '^[^@[:space:]]+@gfsgroup\.cz$' then
    return new;
  end if;
  if coalesce(new.raw_user_meta_data ->> 'app_source', '') <> 'gfs_reporting' then
    return new;
  end if;
  user_name := left(trim(coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))), 80);
  user_position := upper(coalesce(new.raw_user_meta_data ->> 'position', 'T'));
  if user_position not in ('T','FC','FS','HFC') then user_position := 'T'; end if;
  user_role := case when lower(new.email) = 'patrik.kobaj@gfsgroup.cz' then 'admin'::public.reporting_role else 'user'::public.reporting_role end;
  insert into public.reporting_profiles(id, email, name, position, role)
  values (new.id, lower(new.email), user_name, user_position, user_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'reporting_on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
  ) then
    create trigger reporting_on_auth_user_created
      after insert on auth.users
      for each row execute procedure public.reporting_handle_new_auth_user();
  end if;
end $$;

create or replace function public.reporting_claim_profile(p_name text, p_position text)
returns public.reporting_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  result public.reporting_profiles;
begin
  if auth.uid() is null or jwt_email !~ '^[^@[:space:]]+@gfsgroup\.cz$' then
    raise exception 'Povolené jsou jen účty @gfsgroup.cz';
  end if;
  if upper(p_position) not in ('T','FC','FS','HFC') then
    raise exception 'Vyber platnou registrační pozici';
  end if;
  insert into public.reporting_profiles(id, email, name, position, role)
  values (
    auth.uid(), jwt_email, left(trim(p_name), 80), upper(p_position),
    case when jwt_email = 'patrik.kobaj@gfsgroup.cz' then 'admin'::public.reporting_role else 'user'::public.reporting_role end
  )
  on conflict (id) do update set
    email = excluded.email,
    name = case when length(trim(public.reporting_profiles.name)) = 0 then excluded.name else public.reporting_profiles.name end,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.reporting_admin_update_profile(
  p_user_id uuid,
  p_position text,
  p_role public.reporting_role,
  p_status public.reporting_account_status
)
returns public.reporting_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.reporting_profiles;
begin
  if not public.reporting_is_admin() then raise exception 'Přístup jen pro správce'; end if;
  if p_position not in ('T','FC','FS','HFC','TM','AM','AD','RD','GD','P','GA1','GA2','GA3','GA4','GA5') then
    raise exception 'Neplatná pozice';
  end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or p_status <> 'active') then
    raise exception 'Vlastnímu účtu nelze odebrat správu ani jej vypnout';
  end if;
  update public.reporting_profiles
  set position = p_position, role = p_role, status = p_status, updated_at = now()
  where id = p_user_id
  returning * into result;
  if result.id is null then raise exception 'Uživatel nebyl nalezen'; end if;
  return result;
end;
$$;

create or replace function public.reporting_mark_legacy_migrated(p_legacy_user_id uuid)
returns public.reporting_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.reporting_profiles;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  update public.reporting_profiles
  set legacy_user_id = p_legacy_user_id, legacy_migrated_at = now(), updated_at = now()
  where id = auth.uid() and legacy_migrated_at is null
  returning * into result;
  if result.id is null then
    select * into result from public.reporting_profiles where id = auth.uid();
  end if;
  return result;
end;
$$;

create or replace function public.reporting_sync_current_carryovers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_start date;
  current_end date;
  previous_start date;
  previous_end date;
  inserted_count integer;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  select period_start, period_end into current_start, current_end
  from public.reporting_period_for((now() at time zone 'Europe/Prague')::date);
  select period_start, period_end into previous_start, previous_end
  from public.reporting_period_for(current_start - 1);

  insert into public.reporting_projects(
    owner_id, period_start, period_end, root_project_id, previous_project_id,
    name, description, value, unit, state, phase, due_date, is_carryover, carried_from_value
  )
  select
    p.owner_id, current_start, current_end, coalesce(p.root_project_id, p.id), p.id,
    p.name, p.description, p.value, p.unit, 'active', p.phase, p.due_date, true, p.value
  from public.reporting_projects p
  join public.reporting_profiles prof on prof.id = p.owner_id and prof.status = 'active'
  where p.period_start = previous_start and p.period_end = previous_end
    and p.state = 'active' and p.deleted_at is null
  on conflict (previous_project_id, period_start, period_end)
    where previous_project_id is not null and deleted_at is null
  do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.reporting_create_report(p_summary text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_report_id uuid := gen_random_uuid();
  current_start date;
  current_end date;
  item jsonb;
  item_type text;
  item_status text;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  if not jsonb_typeof(p_items) = 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Report musí obsahovat 1 až 100 položek';
  end if;
  select period_start, period_end into current_start, current_end
  from public.reporting_period_for((now() at time zone 'Europe/Prague')::date);
  insert into public.reporting_reports(id, user_id, period_start, period_end, summary)
  values (new_report_id, auth.uid(), current_start, current_end, left(coalesce(p_summary, ''), 1000));

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_type := item ->> 'type';
    item_status := item ->> 'status';
    if item_type = 'project' then
      if item_status not in ('active','completed','cancelled') then raise exception 'Neplatný stav projektu'; end if;
      insert into public.reporting_projects(
        owner_id, source_report_id, period_start, period_end, name, description,
        value, unit, state, phase, due_date, cancellation_reason
      ) values (
        auth.uid(), new_report_id, current_start, current_end,
        left(trim(item ->> 'personName'), 120), left(coalesce(item ->> 'description', ''), 500),
        nullif(item ->> 'amount', '')::numeric, nullif(item ->> 'unit', ''),
        item_status::public.reporting_project_state,
        coalesce(nullif(item ->> 'phase', ''), 'new')::public.reporting_project_phase,
        nullif(item ->> 'dueDate', '')::date,
        case when item_status = 'cancelled' then left(coalesce(item ->> 'note', ''), 500) else null end
      );
    elsif item_type in ('analysis','consulting') then
      if item_status not in ('scheduled','done','cancelled') then raise exception 'Neplatný stav termínu'; end if;
      insert into public.reporting_appointments(
        owner_id, report_id, period_start, period_end, type, client_name,
        description, due_date, due_time, status, note
      ) values (
        auth.uid(), new_report_id, current_start, current_end,
        item_type::public.reporting_appointment_type,
        left(trim(item ->> 'personName'), 120), left(coalesce(item ->> 'description', ''), 500),
        nullif(item ->> 'dueDate', '')::date, nullif(item ->> 'dueTime', '')::time,
        item_status::public.reporting_appointment_status, left(coalesce(item ->> 'note', ''), 500)
      );
    else
      raise exception 'Neplatný typ položky';
    end if;
  end loop;
  return new_report_id;
end;
$$;

create or replace function public.reporting_delete_report(p_report_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_owner uuid;
begin
  select user_id into target_owner from public.reporting_reports where id = p_report_id and deleted_at is null;
  if target_owner is null then return false; end if;
  if target_owner <> auth.uid() and not public.reporting_is_admin() then
    raise exception 'Tento report nemůžeš smazat';
  end if;
  update public.reporting_reports set deleted_at = now(), updated_at = now() where id = p_report_id;
  update public.reporting_projects set deleted_at = now(), updated_at = now()
    where source_report_id = p_report_id and previous_project_id is null;
  update public.reporting_appointments set deleted_at = now(), updated_at = now() where report_id = p_report_id;
  return true;
end;
$$;

alter table public.reporting_profiles enable row level security;
alter table public.reporting_reports enable row level security;
alter table public.reporting_projects enable row level security;
alter table public.reporting_appointments enable row level security;
alter table public.reporting_invitations enable row level security;

create policy reporting_profiles_select on public.reporting_profiles
  for select to authenticated
  using (id = auth.uid() or public.reporting_is_manager());
create policy reporting_reports_select on public.reporting_reports
  for select to authenticated
  using (deleted_at is null and (user_id = auth.uid() or public.reporting_is_manager()));
create policy reporting_reports_insert on public.reporting_reports
  for insert to authenticated
  with check (user_id = auth.uid() and deleted_at is null);
create policy reporting_reports_update on public.reporting_reports
  for update to authenticated
  using (deleted_at is null and (user_id = auth.uid() or public.reporting_is_manager()))
  with check (user_id = auth.uid() or public.reporting_is_manager());
create policy reporting_projects_select on public.reporting_projects
  for select to authenticated
  using (deleted_at is null and (owner_id = auth.uid() or public.reporting_is_manager()));
create policy reporting_projects_insert on public.reporting_projects
  for insert to authenticated
  with check (owner_id = auth.uid() and deleted_at is null);
create policy reporting_projects_update on public.reporting_projects
  for update to authenticated
  using (deleted_at is null and (owner_id = auth.uid() or public.reporting_is_manager()))
  with check (owner_id = auth.uid() or public.reporting_is_manager());
create policy reporting_appointments_select on public.reporting_appointments
  for select to authenticated
  using (deleted_at is null and (owner_id = auth.uid() or public.reporting_is_manager()));
create policy reporting_appointments_insert on public.reporting_appointments
  for insert to authenticated
  with check (owner_id = auth.uid() and deleted_at is null);
create policy reporting_appointments_update on public.reporting_appointments
  for update to authenticated
  using (deleted_at is null and (owner_id = auth.uid() or public.reporting_is_manager()))
  with check (owner_id = auth.uid() or public.reporting_is_manager());
create policy reporting_invitations_admin on public.reporting_invitations
  for all to authenticated
  using (public.reporting_is_admin())
  with check (public.reporting_is_admin());

revoke all on public.reporting_profiles, public.reporting_reports, public.reporting_projects, public.reporting_appointments, public.reporting_invitations from anon;
grant select on public.reporting_profiles, public.reporting_reports, public.reporting_projects, public.reporting_appointments to authenticated;
grant insert on public.reporting_reports, public.reporting_projects, public.reporting_appointments to authenticated;
grant update (summary, sync_status, sync_error, updated_at) on public.reporting_reports to authenticated;
grant update (name, description, value, unit, state, phase, due_date, cancellation_reason, updated_at) on public.reporting_projects to authenticated;
grant update (client_name, description, due_date, due_time, status, note, updated_at) on public.reporting_appointments to authenticated;
grant select, insert, update on public.reporting_invitations to authenticated;

revoke all on function public.reporting_claim_profile(text, text) from public;
revoke all on function public.reporting_admin_update_profile(uuid, text, public.reporting_role, public.reporting_account_status) from public;
revoke all on function public.reporting_sync_current_carryovers() from public;
revoke all on function public.reporting_delete_report(uuid) from public;
revoke all on function public.reporting_mark_legacy_migrated(uuid) from public;
revoke all on function public.reporting_create_report(text, jsonb) from public;
grant execute on function public.reporting_claim_profile(text, text) to authenticated;
grant execute on function public.reporting_admin_update_profile(uuid, text, public.reporting_role, public.reporting_account_status) to authenticated;
grant execute on function public.reporting_sync_current_carryovers() to authenticated;
grant execute on function public.reporting_delete_report(uuid) to authenticated;
grant execute on function public.reporting_mark_legacy_migrated(uuid) to authenticated;
grant execute on function public.reporting_create_report(text, jsonb) to authenticated;

commit;
