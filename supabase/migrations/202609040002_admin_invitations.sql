begin;

alter table public.reporting_invitations
  add column if not exists invite_token uuid not null default gen_random_uuid(),
  add column if not exists accepted_at timestamptz;

create unique index if not exists reporting_invitations_token_unique
  on public.reporting_invitations(invite_token);

with duplicates as (
  select id,
    row_number() over (partition by lower(email) order by created_at desc, id desc) as position
  from public.reporting_invitations
  where revoked_at is null and accepted_at is null
)
update public.reporting_invitations invitation
set revoked_at = now()
from duplicates
where invitation.id = duplicates.id and duplicates.position > 1;

create unique index if not exists reporting_invitations_active_email_unique
  on public.reporting_invitations(lower(email))
  where revoked_at is null and accepted_at is null;

create or replace function public.reporting_admin_create_invitation(
  p_email text,
  p_name text,
  p_position text,
  p_role public.reporting_role
)
returns public.reporting_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(p_email));
  result public.reporting_invitations;
begin
  if not public.reporting_is_admin() then raise exception 'Přístup jen pro správce'; end if;
  if normalized_email !~ '^[^@[:space:]]+@gfsgroup\.cz$' then raise exception 'Použij firemní e-mail @gfsgroup.cz'; end if;
  if length(trim(p_name)) < 2 then raise exception 'Doplň jméno uživatele'; end if;
  if p_position not in ('T','FC','FS','HFC','TM','AM','AD','RD','GD','P','GA1','GA2','GA3','GA4','GA5') then
    raise exception 'Neplatná pozice';
  end if;
  if exists (select 1 from public.reporting_profiles where lower(email) = normalized_email) then
    raise exception 'Uživatel už je registrovaný. Uprav ho v seznamu účtů.';
  end if;

  update public.reporting_invitations
  set revoked_at = now()
  where lower(email) = normalized_email and revoked_at is null and accepted_at is null;

  insert into public.reporting_invitations(email, name, position, role, created_by)
  values (normalized_email, left(trim(p_name), 80), p_position, p_role, auth.uid())
  returning * into result;
  return result;
end;
$$;

create or replace function public.reporting_admin_revoke_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.reporting_is_admin() then raise exception 'Přístup jen pro správce'; end if;
  update public.reporting_invitations
  set revoked_at = now()
  where id = p_invitation_id and revoked_at is null and accepted_at is null;
  if not found then raise exception 'Pozvánka už není aktivní'; end if;
  return true;
end;
$$;

create or replace function public.reporting_get_invitation(p_token uuid)
returns table(email text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select invitation.email, invitation.name
  from public.reporting_invitations invitation
  where invitation.invite_token = p_token
    and invitation.revoked_at is null
    and invitation.accepted_at is null
  limit 1;
$$;

create or replace function public.reporting_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_name text;
  user_position text;
  user_role public.reporting_role;
  token_text text;
  invitation public.reporting_invitations%rowtype;
begin
  if lower(coalesce(new.email, '')) !~ '^[^@[:space:]]+@gfsgroup\.cz$' then return new; end if;
  if coalesce(new.raw_user_meta_data ->> 'app_source', '') <> 'gfs_reporting' then return new; end if;

  token_text := coalesce(new.raw_user_meta_data ->> 'invitation_token', '');
  if token_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into invitation
    from public.reporting_invitations
    where invite_token = token_text::uuid
      and lower(email) = lower(new.email)
      and revoked_at is null
      and accepted_at is null
    for update;
  end if;

  if invitation.id is not null then
    user_name := invitation.name;
    user_position := invitation.position;
    user_role := invitation.role;
  else
    user_name := left(trim(coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))), 80);
    user_position := upper(coalesce(new.raw_user_meta_data ->> 'position', 'T'));
    if user_position not in ('T','FC','FS','HFC') then user_position := 'T'; end if;
    user_role := case when lower(new.email) = 'patrik.kobaj@gfsgroup.cz' then 'admin'::public.reporting_role else 'user'::public.reporting_role end;
  end if;

  if lower(new.email) = 'patrik.kobaj@gfsgroup.cz' then user_role := 'admin'::public.reporting_role; end if;

  insert into public.reporting_profiles(id, email, name, position, role)
  values (new.id, lower(new.email), user_name, user_position, user_role)
  on conflict (id) do nothing;

  if invitation.id is not null then
    update public.reporting_invitations set accepted_at = now() where id = invitation.id;
  end if;
  return new;
end;
$$;

revoke all on function public.reporting_admin_create_invitation(text, text, text, public.reporting_role) from public;
revoke all on function public.reporting_admin_revoke_invitation(uuid) from public;
revoke all on function public.reporting_get_invitation(uuid) from public;
grant execute on function public.reporting_admin_create_invitation(text, text, text, public.reporting_role) to authenticated;
grant execute on function public.reporting_admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.reporting_get_invitation(uuid) to anon, authenticated;

commit;
