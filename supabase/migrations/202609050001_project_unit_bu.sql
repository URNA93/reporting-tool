begin;

update public.reporting_projects
set unit = 'BU', updated_at = now()
where unit is distinct from 'BU';

alter table public.reporting_projects
  alter column unit set default 'BU',
  alter column unit set not null;

alter table public.reporting_projects
  drop constraint if exists reporting_projects_unit_check,
  drop constraint if exists reporting_projects_unit_bu_check;

alter table public.reporting_projects
  add constraint reporting_projects_unit_bu_check check (unit = 'BU');

revoke update (unit) on public.reporting_projects from authenticated;

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
        nullif(item ->> 'amount', '')::numeric, 'BU',
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

commit;
