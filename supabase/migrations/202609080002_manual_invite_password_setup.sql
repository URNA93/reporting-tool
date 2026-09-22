begin;

alter table public.reporting_profiles
  add column if not exists requires_password_setup boolean not null default false;

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
  is_master boolean := public.reporting_is_master_email(new.email);
begin
  if not is_master and not public.reporting_is_company_email(new.email) then return new; end if;
  if not is_master and coalesce(new.raw_user_meta_data ->> 'app_source', '') <> 'gfs_reporting' then return new; end if;

  if is_master then
    user_name := 'Systémový správce';
    user_position := 'T';
    user_role := 'admin'::public.reporting_role;
  else
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
      user_role := 'user'::public.reporting_role;
    end if;
  end if;

  insert into public.reporting_profiles(id, email, name, position, role, requires_password_setup)
  values (new.id, lower(new.email), user_name, user_position, user_role, invitation.id is not null)
  on conflict (id) do update set
    email = excluded.email,
    name = case when is_master then excluded.name else public.reporting_profiles.name end,
    position = case when is_master then excluded.position else public.reporting_profiles.position end,
    role = case when is_master then 'admin'::public.reporting_role else public.reporting_profiles.role end,
    status = case when is_master then 'active'::public.reporting_account_status else public.reporting_profiles.status end,
    requires_password_setup = case when is_master then false else public.reporting_profiles.requires_password_setup end,
    updated_at = now();

  if invitation.id is not null then
    update public.reporting_invitations set accepted_at = now() where id = invitation.id;
  end if;
  return new;
end;
$$;

create or replace function public.reporting_complete_password_setup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Nepřihlášený uživatel'; end if;
  update public.reporting_profiles
  set requires_password_setup = false, updated_at = now()
  where id = auth.uid();
  if not found then raise exception 'Uživatel nebyl nalezen'; end if;
  return true;
end;
$$;

create or replace function public.reporting_admin_start_password_setup(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.reporting_is_admin() then raise exception 'Přístup jen pro správce'; end if;
  if exists (select 1 from public.reporting_profiles where id = p_user_id and public.reporting_is_master_email(email)) then
    raise exception 'Technický účet správce nelze měnit';
  end if;
  update public.reporting_profiles
  set requires_password_setup = true, updated_at = now()
  where id = p_user_id;
  if not found then raise exception 'Uživatel nebyl nalezen'; end if;
  return true;
end;
$$;

revoke all on function public.reporting_complete_password_setup() from public;
revoke all on function public.reporting_admin_start_password_setup(uuid) from public;
grant execute on function public.reporting_complete_password_setup() to authenticated;
grant execute on function public.reporting_admin_start_password_setup(uuid) to authenticated;

commit;
