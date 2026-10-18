-- Úvodní rozhovor šlo dosud jen domluvit; při úpravě teď jde zapsat i to, jak
-- dopadl (hotovo / zrušeno). Nový úvodní rozhovor zůstává při vytvoření vždy
-- "domluvený" (to hlídá reporting_create_report beze změny).
begin;

create or replace function public.reporting_update_appointment(
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

notify pgrst, 'reload schema';

commit;
