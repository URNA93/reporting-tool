begin;

-- Zápis termínu Analýzy/Poradenství jde vždy přes tuto funkci. Je spuštěná
-- vlastníkem databáze, takže ji nemůže zablokovat sloupcové RLS oprávnění;
-- vlastníka položky ale kontroluje uvnitř funkce. Běžný uživatel tak upraví
-- jen vlastní termín, nikoliv cizí položku.
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
  if p_value_bu is not null and p_value_bu < 0 then raise exception 'Objem nemůže být záporný'; end if;

  update public.reporting_appointments
  set client_name = left(trim(p_client_name),120),
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

alter function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text) owner to postgres;
revoke all on function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text) from public;
grant execute on function public.reporting_update_appointment(uuid,text,text,numeric,date,time,text,text) to authenticated;
notify pgrst, 'reload schema';

commit;
