begin;

create or replace function public.reporting_move_analysis_to_consulting(p_appointment_id uuid)
returns public.reporting_appointments
language plpgsql security definer set search_path = '' as $$
declare row public.reporting_appointments; result public.reporting_appointments;
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  select * into row from public.reporting_appointments where id = p_appointment_id and deleted_at is null for update;
  if row.id is null or row.type <> 'analysis' then raise exception 'Analýza nebyla nalezena'; end if;
  if row.owner_id <> auth.uid() and not public.reporting_is_manager() then raise exception 'K této analýze nemáš přístup'; end if;
  update public.reporting_appointments set type = 'consulting', updated_at = now() where id = row.id returning * into result;
  if row.report_id is not null then update public.reporting_reports set sync_status = 'pending', sync_error = null, updated_at = now() where id = row.report_id; end if;
  return result;
end;
$$;
revoke all on function public.reporting_move_analysis_to_consulting(uuid) from public;
grant execute on function public.reporting_move_analysis_to_consulting(uuid) to authenticated;
commit;
