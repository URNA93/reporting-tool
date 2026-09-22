begin;

-- Správce může korigovat procesní fázi oběma směry. Běžný uživatel i
-- manažer mohou dál pouze standardně vpřed; vazba na projekt ani Přepad se
-- při změně procesu nijak nemění.
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
  if project_row.process_stage = p_target_stage::public.reporting_process_stage then return project_row; end if;
  if not public.reporting_is_admin() and not (
    (project_row.process_stage = 'project' and p_target_stage = 'analysis') or
    (project_row.process_stage = 'analysis' and p_target_stage = 'consulting')
  ) then raise exception 'Projekt lze posunout pouze o jeden krok vpřed'; end if;

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

-- Převod termínu probíhá až s kompletními hodnotami formuláře. Tím se
-- Analýza při pouhém kliknutí nikdy nepřepne a zůstává jedním záznamem.
create or replace function public.reporting_convert_analysis_to_consulting(
  p_appointment_id uuid,
  p_client_name text,
  p_description text,
  p_value_bu numeric,
  p_due_date date,
  p_due_time time,
  p_status text,
  p_note text
)
returns public.reporting_appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.reporting_appointments;
  result public.reporting_appointments;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  select * into row from public.reporting_appointments where id = p_appointment_id and deleted_at is null for update;
  if row.id is null or row.type <> 'analysis' then raise exception 'Analýza nebyla nalezena'; end if;
  if row.owner_id <> auth.uid() and not public.reporting_is_manager() then raise exception 'K této analýze nemáš přístup'; end if;
  if p_status not in ('scheduled','done','cancelled') then raise exception 'Neplatný stav termínu'; end if;
  if p_value_bu is not null and p_value_bu < 0 then raise exception 'Objem nemůže být záporný'; end if;

  update public.reporting_appointments
  set type = 'consulting',
      client_name = left(trim(p_client_name),120),
      description = left(coalesce(p_description,''),500),
      value_bu = p_value_bu,
      due_date = p_due_date,
      due_time = p_due_time,
      status = p_status::public.reporting_appointment_status,
      note = left(coalesce(p_note,''),500),
      updated_at = now()
  where id = row.id
  returning * into result;
  if row.report_id is not null then
    update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now() where id = row.report_id;
  end if;
  return result;
end;
$$;

-- Vrácení do Analýzy je korekce dostupná pouze správci. Zachová identitu,
-- vlastníka, reportovací období i vazbu na existující historii.
create or replace function public.reporting_convert_consulting_to_analysis(
  p_appointment_id uuid,
  p_client_name text,
  p_description text,
  p_value_bu numeric,
  p_due_date date,
  p_due_time time,
  p_status text,
  p_note text
)
returns public.reporting_appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.reporting_appointments;
  result public.reporting_appointments;
begin
  if not public.reporting_is_admin() then raise exception 'Přesun zpět do analýzy může provést jen správce'; end if;
  select * into row from public.reporting_appointments where id = p_appointment_id and deleted_at is null for update;
  if row.id is null or row.type <> 'consulting' then raise exception 'Poradenství nebylo nalezeno'; end if;
  if p_status not in ('scheduled','done','cancelled') then raise exception 'Neplatný stav termínu'; end if;

  update public.reporting_appointments
  set type = 'analysis',
      client_name = left(trim(p_client_name),120),
      description = left(coalesce(p_description,''),500),
      value_bu = null,
      due_date = p_due_date,
      due_time = p_due_time,
      status = p_status::public.reporting_appointment_status,
      note = left(coalesce(p_note,''),500),
      updated_at = now()
  where id = row.id
  returning * into result;
  if row.report_id is not null then
    update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now() where id = row.report_id;
  end if;
  return result;
end;
$$;

revoke all on function public.reporting_convert_analysis_to_consulting(uuid,text,text,numeric,date,time,text,text) from public;
grant execute on function public.reporting_convert_analysis_to_consulting(uuid,text,text,numeric,date,time,text,text) to authenticated;
revoke all on function public.reporting_convert_consulting_to_analysis(uuid,text,text,numeric,date,time,text,text) from public;
grant execute on function public.reporting_convert_consulting_to_analysis(uuid,text,text,numeric,date,time,text,text) to authenticated;

-- Starý jednoklikový převod nesmí obejít formulář s hodnotou a termínem.
revoke execute on function public.reporting_move_analysis_to_consulting(uuid) from authenticated;

commit;
