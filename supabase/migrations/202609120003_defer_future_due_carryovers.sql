begin;

-- Přepad vzniká až po období, ve kterém měl projekt skutečně šanci proběhnout.
-- Pokud je jeho termín až za uzávěrkou, zůstává v původním období; po termínu
-- se přenese z posledního aktivního článku stejného projektu.
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
    moved_to_analysis_at, moved_to_consulting_at, due_date, is_carryover, carried_from_value
  )
  select
    p.owner_id, current_start, current_end, coalesce(p.root_project_id, p.id), p.id,
    p.name, p.description, p.value, p.unit, 'active', p.phase, p.process_stage,
    p.moved_to_analysis_at, p.moved_to_consulting_at, p.due_date, true, p.value
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

commit;
