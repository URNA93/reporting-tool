begin;

-- Projekt v procesní fázi Poradenství má stejný plánovací čas jako
-- samostatně zadané poradenství. Čas je součástí projektu, ne nové položky.
alter table public.reporting_projects
  add column if not exists due_time time;

create index if not exists reporting_projects_due_time_idx
  on public.reporting_projects(due_date, due_time)
  where deleted_at is null;

-- Řešitele může přidělit pouze funkce, která zároveň prověřila oprávnění
-- volajícího. Cílový účet musí být aktivní a systémový master účet se nikdy
-- nenabízí ani nepřiřazuje.
create or replace function public.reporting_assert_assignable_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_owner_id is null then raise exception 'Řešitel musí být vybrán'; end if;
  if not exists (
    select 1
    from public.reporting_profiles profile
    where profile.id = p_owner_id
      and profile.status = 'active'
      and not public.reporting_is_master_email(profile.email)
  ) then
    raise exception 'Vybraný řešitel není aktivní účet';
  end if;
end;
$$;

-- Přepad kopíruje i čas poradenství. Procesní fáze, vlastník i identita
-- logického projektu zůstávají stejné jako dosud.
create or replace function public.reporting_sync_current_carryovers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_start date;
  current_end date;
  previous_end date;
  inserted_count integer;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;

  select period_start, period_end into current_start, current_end
  from public.reporting_period_for((now() at time zone 'Europe/Prague')::date);
  select period_end into previous_end
  from public.reporting_period_for(current_start - 1);

  insert into public.reporting_projects(
    owner_id, period_start, period_end, root_project_id, previous_project_id,
    name, description, value, unit, state, phase, process_stage,
    moved_to_analysis_at, moved_to_consulting_at, due_date, due_time, is_carryover, carried_from_value
  )
  select
    p.owner_id, current_start, current_end, coalesce(p.root_project_id, p.id), p.id,
    p.name, p.description, p.value, p.unit, 'active', p.phase, p.process_stage,
    p.moved_to_analysis_at, p.moved_to_consulting_at, p.due_date, p.due_time, true, p.value
  from public.reporting_projects p
  join public.reporting_profiles prof on prof.id = p.owner_id and prof.status = 'active'
  where p.state = 'active'
    and p.deleted_at is null
    and p.period_end < current_start
    and (p.due_date is null or p.due_date <= previous_end)
    and not exists (
      select 1
      from public.reporting_projects next_project
      where next_project.previous_project_id = p.id
        and next_project.deleted_at is null
    )
  on conflict (previous_project_id, period_start, period_end)
    where previous_project_id is not null and deleted_at is null
  do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Změna procesu zachová čas jen v Poradenství; při návratu do Projektu nebo
-- Analýzy se neaktivní čas odstraní, aby se nemíchal s termínem analýzy.
create or replace function public.reporting_move_project_process_stage(
  p_project_id uuid,
  p_target_stage text
)
returns public.reporting_projects
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  project_row public.reporting_projects;
  result public.reporting_projects;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  if p_target_stage not in ('project', 'analysis', 'consulting') then raise exception 'Neplatná procesní fáze'; end if;

  select * into project_row from public.reporting_projects
  where id = p_project_id and deleted_at is null for update;
  if project_row.id is null then raise exception 'Projekt nebyl nalezen'; end if;
  if project_row.owner_id <> auth.uid() and not public.reporting_is_manager() then raise exception 'K tomuto projektu nemáš přístup'; end if;
  if project_row.state <> 'active' then raise exception 'Dokončený nebo zrušený projekt nelze posouvat'; end if;
  if project_row.process_stage = p_target_stage::public.reporting_process_stage then return project_row; end if;
  if not public.reporting_is_admin() and not (
    (project_row.process_stage = 'project' and p_target_stage = 'analysis') or
    (project_row.process_stage = 'analysis' and p_target_stage = 'consulting')
  ) then raise exception 'Projekt lze posunout pouze o jeden krok vpřed'; end if;

  update public.reporting_projects
  set process_stage = p_target_stage::public.reporting_process_stage,
      due_time = case when p_target_stage = 'consulting' then project_row.due_time else null end,
      moved_to_analysis_at = case when p_target_stage = 'analysis' then coalesce(project_row.moved_to_analysis_at, now()) else project_row.moved_to_analysis_at end,
      moved_to_consulting_at = case when p_target_stage = 'consulting' then coalesce(project_row.moved_to_consulting_at, now()) else project_row.moved_to_consulting_at end,
      updated_at = now()
  where id = p_project_id
  returning * into result;
  return result;
end;
$$;

-- Jediná bezpečná cesta pro změnu projektu. Manažer může změnit řešitele,
-- vlastník ne; tím nelze oprávnění obejít ručním requestem.
create or replace function public.reporting_update_project(
  p_project_id uuid,
  p_name text,
  p_description text,
  p_value numeric,
  p_due_date date,
  p_due_time time,
  p_state text,
  p_phase text,
  p_note text,
  p_owner_id uuid
)
returns public.reporting_projects
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  row public.reporting_projects;
  result public.reporting_projects;
  target_owner uuid;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  select * into row from public.reporting_projects where id = p_project_id and deleted_at is null for update;
  if row.id is null then raise exception 'Projekt nebyl nalezen'; end if;
  if row.owner_id <> auth.uid() and not public.reporting_is_manager() then raise exception 'K tomuto projektu nemáš přístup'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Název projektu je povinný'; end if;
  if p_state not in ('active', 'completed', 'cancelled') then raise exception 'Neplatný stav projektu'; end if;
  if p_phase not in ('new', 'contact', 'analysis', 'offer', 'signature', 'processing') then raise exception 'Neplatná fáze projektu'; end if;
  if p_value is not null and p_value < 0 then raise exception 'Objem nemůže být záporný'; end if;
  if p_state = 'cancelled' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Důvod zrušení musí mít alespoň 3 znaky'; end if;
  if p_due_time is not null and row.process_stage <> 'consulting' then raise exception 'Čas lze nastavit pouze u Poradenství'; end if;

  target_owner := coalesce(p_owner_id, row.owner_id);
  if target_owner <> row.owner_id then
    if not public.reporting_is_manager() then raise exception 'Řešitele může změnit jen manažer'; end if;
    perform public.reporting_assert_assignable_owner(target_owner);
  end if;

  update public.reporting_projects
  set owner_id = target_owner,
      name = left(trim(p_name), 120),
      description = left(coalesce(p_description, ''), 500),
      value = p_value,
      state = p_state::public.reporting_project_state,
      phase = p_phase::public.reporting_project_phase,
      due_date = p_due_date,
      due_time = case when row.process_stage = 'consulting' then p_due_time else null end,
      cancellation_reason = case when p_state = 'cancelled' then left(trim(p_note), 500) else null end,
      updated_at = now()
  where id = row.id
  returning * into result;

  if row.source_report_id is not null then
    update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now()
    where id = row.source_report_id and deleted_at is null;
  end if;
  return result;
end;
$$;

drop function if exists public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text);
create function public.reporting_update_appointment(
  p_appointment_id uuid,
  p_client_name text,
  p_description text,
  p_value_bu numeric,
  p_due_date date,
  p_due_time time,
  p_status text,
  p_note text,
  p_owner_id uuid
)
returns public.reporting_appointments
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  row public.reporting_appointments;
  result public.reporting_appointments;
  target_owner uuid;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  select * into row from public.reporting_appointments where id = p_appointment_id and deleted_at is null for update;
  if row.id is null then raise exception 'Termín nebyl nalezen'; end if;
  if row.owner_id <> auth.uid() and not public.reporting_is_manager() then raise exception 'K tomuto termínu nemáš přístup'; end if;
  if p_status not in ('scheduled','done','cancelled') then raise exception 'Neplatný stav termínu'; end if;
  if row.type = 'analysis' and p_value_bu is not null then raise exception 'Analýzy nemají objem v BU'; end if;
  if row.type = 'intro' then
    if p_value_bu is not null then raise exception 'Úvodní rozhovor nemá objem v BU'; end if;
    if coalesce(p_description, '') <> '' then raise exception 'Úvodní rozhovor nemá téma'; end if;
    if p_status <> 'scheduled' then raise exception 'Úvodní rozhovor je vždy domluvený'; end if;
    if p_due_date is null or p_due_time is null then raise exception 'Úvodní rozhovor musí mít datum a čas'; end if;
  end if;
  if p_value_bu is not null and p_value_bu < 0 then raise exception 'Objem nemůže být záporný'; end if;

  target_owner := coalesce(p_owner_id, row.owner_id);
  if target_owner <> row.owner_id then
    if not public.reporting_is_manager() then raise exception 'Řešitele může změnit jen manažer'; end if;
    perform public.reporting_assert_assignable_owner(target_owner);
  end if;

  update public.reporting_appointments
  set owner_id = target_owner,
      client_name = left(trim(p_client_name),120),
      description = case when row.type = 'intro' then '' else left(coalesce(p_description,''),500) end,
      value_bu = case when row.type = 'consulting' then p_value_bu else null end,
      due_date = p_due_date,
      due_time = p_due_time,
      status = p_status::public.reporting_appointment_status,
      note = left(coalesce(p_note,''),500),
      updated_at = now()
  where id = row.id
  returning * into result;
  if row.report_id is not null then
    update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now()
    where id = row.report_id;
  end if;
  return result;
end;
$$;

drop function if exists public.reporting_convert_analysis_to_consulting(uuid,text,text,numeric,date,time,text,text);
create function public.reporting_convert_analysis_to_consulting(
  p_appointment_id uuid, p_client_name text, p_description text, p_value_bu numeric,
  p_due_date date, p_due_time time, p_status text, p_note text, p_owner_id uuid
)
returns public.reporting_appointments
language plpgsql security definer set search_path = '' set row_security = off
as $$
declare row public.reporting_appointments; result public.reporting_appointments; target_owner uuid;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  select * into row from public.reporting_appointments where id = p_appointment_id and deleted_at is null for update;
  if row.id is null or row.type <> 'analysis' then raise exception 'Analýza nebyla nalezena'; end if;
  if row.owner_id <> auth.uid() and not public.reporting_is_manager() then raise exception 'K této analýze nemáš přístup'; end if;
  if p_status not in ('scheduled','done','cancelled') then raise exception 'Neplatný stav termínu'; end if;
  if p_value_bu is not null and p_value_bu < 0 then raise exception 'Objem nemůže být záporný'; end if;
  target_owner := coalesce(p_owner_id, row.owner_id);
  if target_owner <> row.owner_id then
    if not public.reporting_is_manager() then raise exception 'Řešitele může změnit jen manažer'; end if;
    perform public.reporting_assert_assignable_owner(target_owner);
  end if;
  update public.reporting_appointments
  set type = 'consulting', owner_id = target_owner, client_name = left(trim(p_client_name),120),
      description = left(coalesce(p_description,''),500), value_bu = p_value_bu,
      due_date = p_due_date, due_time = p_due_time, status = p_status::public.reporting_appointment_status,
      note = left(coalesce(p_note,''),500), updated_at = now()
  where id = row.id returning * into result;
  if row.report_id is not null then update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now() where id = row.report_id; end if;
  return result;
end;
$$;

drop function if exists public.reporting_convert_consulting_to_analysis(uuid,text,text,numeric,date,time,text,text);
create function public.reporting_convert_consulting_to_analysis(
  p_appointment_id uuid, p_client_name text, p_description text, p_value_bu numeric,
  p_due_date date, p_due_time time, p_status text, p_note text, p_owner_id uuid
)
returns public.reporting_appointments
language plpgsql security definer set search_path = '' set row_security = off
as $$
declare row public.reporting_appointments; result public.reporting_appointments; target_owner uuid;
begin
  if not public.reporting_is_admin() then raise exception 'Přesun zpět do analýzy může provést jen správce'; end if;
  select * into row from public.reporting_appointments where id = p_appointment_id and deleted_at is null for update;
  if row.id is null or row.type <> 'consulting' then raise exception 'Poradenství nebylo nalezeno'; end if;
  if p_status not in ('scheduled','done','cancelled') then raise exception 'Neplatný stav termínu'; end if;
  target_owner := coalesce(p_owner_id, row.owner_id);
  if target_owner <> row.owner_id then perform public.reporting_assert_assignable_owner(target_owner); end if;
  update public.reporting_appointments
  set type = 'analysis', owner_id = target_owner, client_name = left(trim(p_client_name),120),
      description = left(coalesce(p_description,''),500), value_bu = null,
      due_date = p_due_date, due_time = p_due_time, status = p_status::public.reporting_appointment_status,
      note = left(coalesce(p_note,''),500), updated_at = now()
  where id = row.id returning * into result;
  if row.report_id is not null then update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now() where id = row.report_id; end if;
  return result;
end;
$$;

alter function public.reporting_assert_assignable_owner(uuid) owner to postgres;
alter function public.reporting_move_project_process_stage(uuid, text) owner to postgres;
alter function public.reporting_update_project(uuid,text,text,numeric,date,time,text,text,text,uuid) owner to postgres;
alter function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text,uuid) owner to postgres;
alter function public.reporting_convert_analysis_to_consulting(uuid,text,text,numeric,date,time,text,text,uuid) owner to postgres;
alter function public.reporting_convert_consulting_to_analysis(uuid,text,text,numeric,date,time,text,text,uuid) owner to postgres;

revoke all on function public.reporting_assert_assignable_owner(uuid) from public;
revoke all on function public.reporting_update_project(uuid,text,text,numeric,date,time,text,text,text,uuid) from public;
revoke all on function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text,uuid) from public;
revoke all on function public.reporting_convert_analysis_to_consulting(uuid,text,text,numeric,date,time,text,text,uuid) from public;
revoke all on function public.reporting_convert_consulting_to_analysis(uuid,text,text,numeric,date,time,text,text,uuid) from public;
grant execute on function public.reporting_move_project_process_stage(uuid, text) to authenticated;
grant execute on function public.reporting_update_project(uuid,text,text,numeric,date,time,text,text,text,uuid) to authenticated;
grant execute on function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text,uuid) to authenticated;
grant execute on function public.reporting_convert_analysis_to_consulting(uuid,text,text,numeric,date,time,text,text,uuid) to authenticated;
grant execute on function public.reporting_convert_consulting_to_analysis(uuid,text,text,numeric,date,time,text,text,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
