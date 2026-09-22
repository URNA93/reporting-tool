-- Úvodní rozhovor je další typ termínu. Používá stejnou tabulku jako analýzy
-- a poradenství, aby zůstaly zachované vazby na report, vlastníka a synchronizaci.
alter type public.reporting_appointment_type add value if not exists 'intro';

begin;

create or replace function public.reporting_create_report(p_summary text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  new_report_id uuid := gen_random_uuid();
  current_start date;
  current_end date;
  item jsonb;
  item_type text;
  item_status text;
  item_value_bu numeric(16,2);
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
        nullif(item ->> 'amount', '')::numeric, 'BU',
        item_status::public.reporting_project_state,
        coalesce(nullif(item ->> 'phase', ''), 'new')::public.reporting_project_phase,
        nullif(item ->> 'dueDate', '')::date,
        case when item_status = 'cancelled' then left(coalesce(item ->> 'note', ''), 500) else null end
      );
    elsif item_type in ('analysis','consulting','intro') then
      if item_type = 'intro' then
        if item_status <> 'scheduled' then raise exception 'Úvodní rozhovor je vždy domluvený'; end if;
        if nullif(item ->> 'dueDate', '') is null or nullif(item ->> 'dueTime', '') is null then
          raise exception 'Úvodní rozhovor musí mít datum a čas';
        end if;
      elsif item_status not in ('scheduled','done','cancelled') then
        raise exception 'Neplatný stav termínu';
      end if;

      item_value_bu := null;
      if item_type = 'consulting' and nullif(item ->> 'amount', '') is not null then
        if item ->> 'amount' !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Objem v BU není platný'; end if;
        item_value_bu := (item ->> 'amount')::numeric;
        if item_value_bu > 100000000 then raise exception 'Objem v BU je příliš vysoký'; end if;
      elsif item_type = 'intro' and nullif(item ->> 'amount', '') is not null then
        raise exception 'Úvodní rozhovor nemá objem v BU';
      end if;

      insert into public.reporting_appointments(
        owner_id, report_id, period_start, period_end, type, client_name,
        description, value_bu, due_date, due_time, status, note
      ) values (
        auth.uid(), new_report_id, current_start, current_end,
        item_type::public.reporting_appointment_type,
        left(trim(item ->> 'personName'), 120),
        case when item_type = 'intro' then '' else left(coalesce(item ->> 'description', ''), 500) end,
        item_value_bu,
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

create or replace function public.reporting_update_appointment(
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
set row_security = off
as $$
declare
  row public.reporting_appointments;
  result public.reporting_appointments;
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

  update public.reporting_appointments
  set client_name = left(trim(p_client_name),120),
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
    update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now() where id = row.report_id;
  end if;
  return result;
end;
$$;

create or replace function public.reporting_delete_item(p_item_id uuid, p_item_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_owner uuid;
  target_report uuid;
  is_carryover boolean;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  if p_item_type = 'project' then
    select owner_id, source_report_id, previous_project_id is not null
    into target_owner, target_report, is_carryover
    from public.reporting_projects
    where id = p_item_id and deleted_at is null;
    if target_owner is null then return false; end if;
    if is_carryover then raise exception 'Přepad nelze smazat'; end if;
    if target_owner <> auth.uid() and not public.reporting_is_manager() then raise exception 'Tuto položku nemůžeš smazat'; end if;
    update public.reporting_projects set deleted_at = now(), updated_at = now() where id = p_item_id;
  elsif p_item_type in ('analysis', 'consulting', 'intro') then
    select owner_id, report_id into target_owner, target_report
    from public.reporting_appointments
    where id = p_item_id and deleted_at is null and type::text = p_item_type;
    if target_owner is null then return false; end if;
    if target_owner <> auth.uid() and not public.reporting_is_manager() then raise exception 'Tuto položku nemůžeš smazat'; end if;
    update public.reporting_appointments set deleted_at = now(), updated_at = now() where id = p_item_id;
  else
    raise exception 'Neplatný typ položky';
  end if;

  insert into public.reporting_sheet_deletions(action, target_id)
  values ('item', p_item_id)
  on conflict (action, target_id) do nothing;

  if target_report is not null then
    update public.reporting_reports
    set sync_status = 'pending', sync_error = null, updated_at = now()
    where id = target_report and deleted_at is null;
  end if;
  return true;
end;
$$;

alter function public.reporting_create_report(text, jsonb) owner to postgres;
alter function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text) owner to postgres;
alter function public.reporting_delete_item(uuid, text) owner to postgres;
revoke all on function public.reporting_create_report(text, jsonb) from public;
revoke all on function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text) from public;
revoke all on function public.reporting_delete_item(uuid, text) from public;
grant execute on function public.reporting_create_report(text, jsonb) to authenticated;
grant execute on function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text) to authenticated;
grant execute on function public.reporting_delete_item(uuid, text) to authenticated;
notify pgrst, 'reload schema';

commit;
