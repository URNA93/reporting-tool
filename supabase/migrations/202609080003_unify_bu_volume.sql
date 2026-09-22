begin;

-- Keep the former point values intact for audit/history, but use one BU field from now on.
alter table public.reporting_appointments
  add column if not exists value_bu numeric(16,2);

update public.reporting_appointments
set value_bu = points
where value_bu is null and points is not null;

alter table public.reporting_appointments
  drop constraint if exists reporting_appointments_value_bu_check;

alter table public.reporting_appointments
  add constraint reporting_appointments_value_bu_check
  check (value_bu is null or (type = 'consulting' and value_bu >= 0));

grant update (value_bu) on public.reporting_appointments to authenticated;

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
    elsif item_type in ('analysis','consulting') then
      if item_status not in ('scheduled','done','cancelled') then raise exception 'Neplatný stav termínu'; end if;
      item_value_bu := null;
      if item_type = 'consulting' and nullif(item ->> 'amount', '') is not null then
        if item ->> 'amount' !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Objem v BU není platný'; end if;
        item_value_bu := (item ->> 'amount')::numeric;
        if item_value_bu > 100000000 then raise exception 'Objem v BU je příliš vysoký'; end if;
      end if;
      insert into public.reporting_appointments(
        owner_id, report_id, period_start, period_end, type, client_name,
        description, value_bu, due_date, due_time, status, note
      ) values (
        auth.uid(), new_report_id, current_start, current_end,
        item_type::public.reporting_appointment_type,
        left(trim(item ->> 'personName'), 120), left(coalesce(item ->> 'description', ''), 500), item_value_bu,
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

revoke all on function public.reporting_create_report(text, jsonb) from public;
grant execute on function public.reporting_create_report(text, jsonb) to authenticated;

commit;
