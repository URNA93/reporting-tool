begin;

-- Procesní etapa je úmyslně oddělená od obchodní fáze (Nabídka, Podpis apod.).
do $$ begin
  create type public.reporting_process_stage as enum ('project', 'analysis', 'consulting');
exception when duplicate_object then null; end $$;

alter table public.reporting_projects
  add column if not exists process_stage public.reporting_process_stage not null default 'project',
  add column if not exists moved_to_analysis_at timestamptz,
  add column if not exists moved_to_consulting_at timestamptz;

update public.reporting_projects
set process_stage = 'project'
where process_stage is null;

create index if not exists reporting_projects_process_stage_idx
  on public.reporting_projects(process_stage, state, period_end)
  where deleted_at is null;

-- Přepad je stále tentýž logický projekt v novém období: kopíruje procesní
-- fázi i data dřívějších přechodů, ale vzniká jen jednou díky stávajícímu indexu.
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
    name, description, value, unit, state, phase, process_stage,
    moved_to_analysis_at, moved_to_consulting_at, due_date, is_carryover, carried_from_value
  )
  select
    p.owner_id, current_start, current_end, coalesce(p.root_project_id, p.id), p.id,
    p.name, p.description, p.value, p.unit, 'active', p.phase, p.process_stage,
    p.moved_to_analysis_at, p.moved_to_consulting_at, p.due_date, true, p.value
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

-- Jediný povolený způsob změny procesní fáze. Kontroluje vlastníka i manažery
-- na databázové vrstvě a nedovolí přeskočit krok ani měnit dokončený projekt.
create or replace function public.reporting_move_project_process_stage(
  p_project_id uuid,
  p_target_stage text
)
returns public.reporting_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_row public.reporting_projects;
  result public.reporting_projects;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  if p_target_stage not in ('project', 'analysis', 'consulting') then raise exception 'Neplatná procesní fáze'; end if;

  select * into project_row
  from public.reporting_projects
  where id = p_project_id and deleted_at is null
  for update;
  if project_row.id is null then raise exception 'Projekt nebyl nalezen'; end if;
  if project_row.owner_id <> auth.uid() and not public.reporting_is_manager() then raise exception 'K tomuto projektu nemáš přístup'; end if;
  if project_row.state <> 'active' then raise exception 'Dokončený nebo zrušený projekt nelze posouvat'; end if;
  if not (
    (project_row.process_stage = 'project' and p_target_stage = 'analysis') or
    (project_row.process_stage = 'analysis' and p_target_stage in ('project', 'consulting')) or
    (project_row.process_stage = 'consulting' and p_target_stage = 'analysis')
  ) then raise exception 'Projekt lze posunout jen o jeden procesní krok'; end if;

  update public.reporting_projects
  set process_stage = p_target_stage::public.reporting_process_stage,
      moved_to_analysis_at = case when p_target_stage = 'analysis' then coalesce(project_row.moved_to_analysis_at, now()) else project_row.moved_to_analysis_at end,
      moved_to_consulting_at = case when p_target_stage = 'consulting' then coalesce(project_row.moved_to_consulting_at, now()) else project_row.moved_to_consulting_at end,
      updated_at = now()
  where id = p_project_id
  returning * into result;
  return result;
end;
$$;

revoke all on function public.reporting_move_project_process_stage(uuid, text) from public;
grant execute on function public.reporting_move_project_process_stage(uuid, text) to authenticated;

-- E-mail ani Auth identita se tady nikdy nemění; vztahy dál vedou přes id.
drop function if exists public.reporting_admin_update_profile(
  uuid, text, public.reporting_role, public.reporting_account_status
);

create function public.reporting_admin_update_profile(
  p_user_id uuid,
  p_name text,
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
  if exists (select 1 from public.reporting_profiles where id = p_user_id and public.reporting_is_master_email(email)) then
    raise exception 'Technický účet správce nelze měnit';
  end if;
  if length(trim(p_name)) < 2 or length(trim(p_name)) > 80 then raise exception 'Jméno musí mít 2 až 80 znaků'; end if;
  if p_position not in ('T','FC','FS','HFC','TM','AM','AD','RD','GD','P','GA1','GA2','GA3','GA4','GA5') then raise exception 'Neplatná pozice'; end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or p_status <> 'active') then raise exception 'Vlastnímu účtu nelze odebrat správu ani jej vypnout'; end if;
  update public.reporting_profiles
  set name = left(trim(p_name), 80), position = p_position, role = p_role, status = p_status, updated_at = now()
  where id = p_user_id
  returning * into result;
  if result.id is null then raise exception 'Uživatel nebyl nalezen'; end if;
  return result;
end;
$$;

revoke all on function public.reporting_admin_update_profile(uuid, text, text, public.reporting_role, public.reporting_account_status) from public;
grant execute on function public.reporting_admin_update_profile(uuid, text, text, public.reporting_role, public.reporting_account_status) to authenticated;

commit;
