begin;

create table if not exists public.reporting_system_config (
  config_key text primary key,
  config_value text not null,
  updated_at timestamptz not null default now()
);

alter table public.reporting_system_config enable row level security;

create or replace function public.reporting_is_master_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reporting_system_config
    where config_key = 'master_admin_email'
      and config_value = lower(trim(coalesce(p_email, '')))
  );
$$;

create or replace function public.reporting_is_company_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reporting_system_config
    where config_key = 'company_domain'
      and config_value = split_part(lower(trim(coalesce(p_email, ''))), '@', 2)
      and lower(trim(coalesce(p_email, ''))) like '%@' || config_value
  );
$$;

revoke all on table public.reporting_system_config from anon, authenticated;
revoke all on function public.reporting_is_master_email(text) from public;
revoke all on function public.reporting_is_company_email(text) from public;
grant execute on function public.reporting_is_master_email(text) to authenticated;
grant execute on function public.reporting_is_company_email(text) to authenticated;

alter table public.reporting_profiles
  drop constraint if exists reporting_profiles_company_email;

alter table public.reporting_profiles
  add constraint reporting_profiles_company_email check (
    public.reporting_is_company_email(email)
    or public.reporting_is_master_email(email)
  );

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

  insert into public.reporting_profiles(id, email, name, position, role)
  values (new.id, lower(new.email), user_name, user_position, user_role)
  on conflict (id) do update set
    email = excluded.email,
    name = case when is_master then excluded.name else public.reporting_profiles.name end,
    position = case when is_master then excluded.position else public.reporting_profiles.position end,
    role = case when is_master then 'admin'::public.reporting_role else public.reporting_profiles.role end,
    status = case when is_master then 'active'::public.reporting_account_status else public.reporting_profiles.status end,
    updated_at = now();

  if invitation.id is not null then
    update public.reporting_invitations set accepted_at = now() where id = invitation.id;
  end if;
  return new;
end;
$$;

create or replace function public.reporting_claim_profile(p_name text, p_position text)
returns public.reporting_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  is_master boolean := public.reporting_is_master_email(jwt_email);
  result public.reporting_profiles;
begin
  if auth.uid() is null or (not is_master and not public.reporting_is_company_email(jwt_email)) then
    raise exception 'Tento účet nemá k aplikaci přístup';
  end if;
  if not is_master and upper(p_position) not in ('T','FC','FS','HFC') then
    raise exception 'Vyber platnou registrační pozici';
  end if;
  insert into public.reporting_profiles(id, email, name, position, role)
  values (
    auth.uid(), jwt_email,
    case when is_master then 'Systémový správce' else left(trim(p_name), 80) end,
    case when is_master then 'T' else upper(p_position) end,
    case when is_master then 'admin'::public.reporting_role else 'user'::public.reporting_role end
  )
  on conflict (id) do update set
    email = excluded.email,
    name = case when is_master then excluded.name when length(trim(public.reporting_profiles.name)) = 0 then excluded.name else public.reporting_profiles.name end,
    role = case when is_master then 'admin'::public.reporting_role else public.reporting_profiles.role end,
    status = case when is_master then 'active'::public.reporting_account_status else public.reporting_profiles.status end,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.reporting_admin_update_profile(
  p_user_id uuid,
  p_position text,
  p_role public.reporting_role,
  p_status public.reporting_account_status
)
returns public.reporting_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.reporting_profiles;
begin
  if not public.reporting_is_admin() then raise exception 'Přístup jen pro správce'; end if;
  if exists (select 1 from public.reporting_profiles where id = p_user_id and public.reporting_is_master_email(email)) then
    raise exception 'Technický účet správce nelze měnit';
  end if;
  if p_position not in ('T','FC','FS','HFC','TM','AM','AD','RD','GD','P','GA1','GA2','GA3','GA4','GA5') then
    raise exception 'Neplatná pozice';
  end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or p_status <> 'active') then
    raise exception 'Vlastnímu účtu nelze odebrat správu ani jej vypnout';
  end if;
  update public.reporting_profiles
  set position = p_position, role = p_role, status = p_status, updated_at = now()
  where id = p_user_id
  returning * into result;
  if result.id is null then raise exception 'Uživatel nebyl nalezen'; end if;
  return result;
end;
$$;

drop policy if exists reporting_profiles_select on public.reporting_profiles;
create policy reporting_profiles_select on public.reporting_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.reporting_is_manager() and not public.reporting_is_master_email(email))
  );

insert into public.reporting_profiles(id, email, name, position, role, status)
select id, lower(email), 'Systémový správce', 'T', 'admin', 'active'
from auth.users
where public.reporting_is_master_email(email)
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  position = excluded.position,
  role = excluded.role,
  status = excluded.status,
  updated_at = now();

commit;
