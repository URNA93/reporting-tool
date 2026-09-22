begin;

create table if not exists public.reporting_sheet_deletions (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('item', 'report')),
  target_id uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (action, target_id)
);

create index if not exists reporting_sheet_deletions_pending_idx
  on public.reporting_sheet_deletions(created_at)
  where completed_at is null;

alter table public.reporting_sheet_deletions enable row level security;
revoke all on public.reporting_sheet_deletions from anon, authenticated;

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
  elsif p_item_type in ('analysis', 'consulting') then
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

create or replace function public.reporting_delete_report(p_report_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_owner uuid;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  select user_id into target_owner from public.reporting_reports where id = p_report_id and deleted_at is null;
  if target_owner is null then return false; end if;
  if target_owner <> auth.uid() and not public.reporting_is_admin() then raise exception 'Tento report nemůžeš smazat'; end if;
  update public.reporting_reports set deleted_at = now(), updated_at = now() where id = p_report_id;
  update public.reporting_projects set deleted_at = now(), updated_at = now()
    where source_report_id = p_report_id and previous_project_id is null;
  update public.reporting_appointments set deleted_at = now(), updated_at = now() where report_id = p_report_id;
  insert into public.reporting_sheet_deletions(action, target_id)
  values ('report', p_report_id)
  on conflict (action, target_id) do nothing;
  return true;
end;
$$;

create or replace function public.reporting_complete_sheet_deletion(p_action text, p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_owner uuid;
begin
  if auth.uid() is null or p_action not in ('item', 'report') then raise exception 'Neplatný požadavek'; end if;
  if p_action = 'report' then
    select user_id into target_owner from public.reporting_reports where id = p_target_id;
    if target_owner is null or (target_owner <> auth.uid() and not public.reporting_is_admin()) then raise exception 'Přístup zamítnut'; end if;
  else
    select owner_id into target_owner from public.reporting_projects where id = p_target_id;
    if target_owner is null then select owner_id into target_owner from public.reporting_appointments where id = p_target_id; end if;
    if target_owner is null or (target_owner <> auth.uid() and not public.reporting_is_manager()) then raise exception 'Přístup zamítnut'; end if;
  end if;
  update public.reporting_sheet_deletions
  set completed_at = now()
  where action = p_action and target_id = p_target_id and completed_at is null;
  return true;
end;
$$;

create or replace function public.reporting_list_pending_sheet_deletions()
returns table(action text, target_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.reporting_is_admin() then raise exception 'Přístup jen pro správce'; end if;
  return query
  select deletion.action, deletion.target_id
  from public.reporting_sheet_deletions deletion
  where deletion.completed_at is null
  order by deletion.created_at
  limit 100;
end;
$$;

revoke all on function public.reporting_delete_item(uuid, text) from public;
revoke all on function public.reporting_delete_report(uuid) from public;
revoke all on function public.reporting_complete_sheet_deletion(text, uuid) from public;
revoke all on function public.reporting_list_pending_sheet_deletions() from public;
grant execute on function public.reporting_delete_item(uuid, text) to authenticated;
grant execute on function public.reporting_delete_report(uuid) to authenticated;
grant execute on function public.reporting_complete_sheet_deletion(text, uuid) to authenticated;
grant execute on function public.reporting_list_pending_sheet_deletions() to authenticated;

commit;
