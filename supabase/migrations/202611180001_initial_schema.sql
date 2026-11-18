create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'manager', 'contributor', 'editor', 'viewer');
create type public.asset_media_type as enum ('video', 'audio', 'image', 'document', 'archive', 'other');
create type public.asset_status as enum ('uploading', 'processing', 'pending_review', 'approved', 'rejected', 'failed');
create type public.ai_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = timezone('utc', now()); return new; end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  role public.app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default timezone('utc', now()),
  primary key (team_id, user_id)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  icon text,
  color text,
  navigation_group text not null default 'library' check (navigation_group in ('library', 'resources', 'projects')),
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references public.collections(id) on delete set null,
  parent_id uuid references public.folders(id) on delete restrict,
  name text not null,
  slug text not null,
  description text,
  icon text,
  color text,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  is_private boolean not null default false,
  require_approval boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique nulls not distinct (collection_id, parent_id, slug)
);
create index folders_parent_order_idx on public.folders(parent_id, sort_order, name) where not is_archived;
create index folders_collection_idx on public.folders(collection_id, sort_order) where not is_archived;
create table public.folder_members (
  folder_id uuid not null references public.folders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  can_upload boolean not null default false,
  can_download boolean not null default true,
  added_at timestamptz not null default timezone('utc', now()),
  primary key(folder_id, user_id)
);
create table public.folder_teams (
  folder_id uuid not null references public.folders(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  can_upload boolean not null default false,
  can_download boolean not null default true,
  primary key(folder_id, team_id)
);

create or replace function public.validate_folder_parent()
returns trigger language plpgsql as $$
declare parent_depth integer; is_cycle boolean;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'A folder cannot be its own parent'; end if;
  with recursive ancestors(id, parent_id, depth) as (
    select f.id, f.parent_id, 1 from public.folders f where f.id = new.parent_id
    union all select f.id, f.parent_id, a.depth + 1 from public.folders f join ancestors a on f.id = a.parent_id
  ) select max(depth), bool_or(id = new.id) into parent_depth, is_cycle from ancestors;
  if coalesce(is_cycle, false) then raise exception 'Moving this folder would create a cycle'; end if;
  if coalesce(parent_depth, 0) >= 8 then raise exception 'Folder nesting is limited to 8 levels'; end if;
  return new;
end;
$$;
create trigger folders_validate_parent before insert or update of parent_id on public.folders for each row execute function public.validate_folder_parent();

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.folders(id) on delete set null,
  collection_id uuid references public.collections(id) on delete set null,
  title text not null,
  description text,
  original_filename text not null,
  object_key text not null unique,
  storage_provider text not null default 'r2' check (storage_provider in ('r2', 'local')),
  mime_type text not null,
  media_type public.asset_media_type not null default 'other',
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  checksum_sha256 text,
  status public.asset_status not null default 'uploading',
  duration_seconds numeric(12,3),
  width integer,
  height integer,
  thumbnail_object_key text,
  metadata jsonb not null default '{}'::jsonb,
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(original_filename, '')), 'C')
  ) stored,
  uploaded_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index assets_folder_created_idx on public.assets(folder_id, created_at desc) where deleted_at is null;
create index assets_collection_created_idx on public.assets(collection_id, created_at desc) where deleted_at is null;
create index assets_status_created_idx on public.assets(status, created_at desc) where deleted_at is null;
create index assets_search_idx on public.assets using gin(search_document);
create index assets_metadata_idx on public.assets using gin(metadata);

create table public.upload_sessions (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  provider_upload_id text not null unique,
  expected_bytes bigint not null check (expected_bytes > 0),
  part_size_bytes bigint not null check (part_size_bytes >= 5242880),
  state text not null default 'uploading' check (state in ('uploading', 'completed', 'aborted', 'failed')),
  expires_at timestamptz not null default timezone('utc', now()) + interval '24 hours',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index upload_sessions_expiry_idx on public.upload_sessions(expires_at) where state = 'uploading';

create table public.workspace_storage_limits (
  singleton boolean primary key default true check (singleton),
  max_bytes bigint not null check (max_bytes > 0),
  updated_at timestamptz not null default timezone('utc', now())
);
insert into public.workspace_storage_limits(singleton, max_bytes) values (true, 9000000000);

create or replace function public.reserve_upload_session(p_asset_id uuid, p_provider_upload_id text, p_expected_bytes bigint, p_part_size_bytes bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_limit bigint; v_used bigint; v_owner uuid; v_size bigint;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles where id = (select auth.uid()) and is_active
    and role = any(array['admin','manager','contributor','editor']::public.app_role[])) then
    raise exception 'Account does not have upload access';
  end if;
  update public.assets set status = 'failed' where id in (
    select us.asset_id from public.upload_sessions us where us.state = 'uploading' and us.expires_at <= timezone('utc', now())
  ) and status = 'uploading';
  update public.upload_sessions set state = 'failed' where state = 'uploading' and expires_at <= timezone('utc', now());
  select a.uploaded_by, a.file_size_bytes into v_owner, v_size
    from public.assets a where a.id = p_asset_id and a.status = 'uploading' and a.deleted_at is null;
  if v_owner is distinct from (select auth.uid()) or v_size is distinct from p_expected_bytes then
    raise exception 'Upload asset does not belong to this user';
  end if;
  perform 1 from public.workspace_storage_limits where singleton for update;
  select max_bytes into v_limit from public.workspace_storage_limits where singleton;
  -- Soft-deleted assets still occupy R2 until object deletion is implemented and confirmed.
  select coalesce(sum(file_size_bytes), 0) into v_used from public.assets where status <> 'failed';
  if v_used > v_limit then raise exception using errcode = 'P0001', message = 'storage_budget_exceeded'; end if;
  insert into public.upload_sessions(asset_id, provider_upload_id, expected_bytes, part_size_bytes)
    values (p_asset_id, p_provider_upload_id, p_expected_bytes, p_part_size_bytes);
end;
$$;

create table public.asset_tags (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  tag text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(asset_id, tag)
);
create index asset_tags_tag_idx on public.asset_tags(tag);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.finalize_asset_upload(p_asset_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_folder uuid; v_requires_approval boolean; v_status text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles where id = (select auth.uid()) and is_active
    and role = any(array['admin','manager','contributor','editor']::public.app_role[])) then
    raise exception 'Account does not have upload access';
  end if;
  select a.uploaded_by, a.folder_id, coalesce(f.require_approval, false)
    into v_owner, v_folder, v_requires_approval
    from public.assets a left join public.folders f on f.id = a.folder_id
    where a.id = p_asset_id and a.status = 'uploading' and a.deleted_at is null;
  if v_owner is distinct from (select auth.uid()) and not public.has_workspace_role(array['admin','manager']::public.app_role[]) then
    raise exception 'Upload is not owned by this user';
  end if;
  update public.upload_sessions set state = 'completed'
    where asset_id = p_asset_id and state = 'uploading' and expires_at > timezone('utc', now());
  if not found then raise exception 'Upload session is not active'; end if;
  v_status := case when v_requires_approval then 'pending_review' else 'processing' end;
  update public.assets set status = v_status where id = p_asset_id;
  if v_requires_approval then
    insert into public.approval_requests(asset_id, requested_by) values (p_asset_id, v_owner);
  end if;
  return v_status;
end;
$$;

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  job_type text not null check (job_type in ('video_analysis', 'transcription', 'metadata')),
  status public.ai_job_status not null default 'queued',
  provider text not null default 'gemini',
  provider_job_id text,
  input_hash text not null,
  result jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique(asset_id, job_type, input_hash)
);
create index ai_jobs_queue_idx on public.ai_jobs(status, created_at) where status = 'queued';
create table public.asset_transcripts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  source_job_id uuid references public.ai_jobs(id) on delete set null,
  language text,
  transcript jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(asset_id, source_job_id)
);

create table public.activity_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index activity_events_created_idx on public.activity_events(created_at desc);

create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and is_active
$$;
create or replace function public.has_workspace_role(allowed public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role() = any(allowed), false)
$$;
create or replace function public.can_access_folder(target_folder uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive chain(id, parent_id, is_private) as (
    select f.id, f.parent_id, f.is_private from public.folders f where f.id = target_folder
    union all select p.id, p.parent_id, p.is_private from public.folders p join chain c on p.id = c.parent_id
  )
  select public.current_user_role() is not null and (
    public.has_workspace_role(array['admin','manager']::public.app_role[])
    or not exists(select 1 from chain c where c.is_private and not (
      exists(select 1 from public.folder_members fm where fm.folder_id = c.id and fm.user_id = (select auth.uid()))
      or exists(select 1 from public.folder_teams ft join public.team_members tm on tm.team_id = ft.team_id where ft.folder_id = c.id and tm.user_id = (select auth.uid()))
    )))
$$;
create or replace function public.can_upload_to_folder(target_folder uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive chain(id, parent_id, is_private) as (
    select f.id, f.parent_id, f.is_private from public.folders f where f.id = target_folder
    union all select p.id, p.parent_id, p.is_private from public.folders p join chain c on p.id = c.parent_id
  )
  select public.has_workspace_role(array['admin','manager']::public.app_role[])
    or (public.has_workspace_role(array['contributor','editor']::public.app_role[])
      and not exists(select 1 from chain c where c.is_private and not (
        exists(select 1 from public.folder_members fm where fm.folder_id = c.id and fm.user_id = (select auth.uid()) and fm.can_upload)
        or exists(select 1 from public.folder_teams ft join public.team_members tm on tm.team_id = ft.team_id where ft.folder_id = c.id and tm.user_id = (select auth.uid()) and ft.can_upload)
      )))
$$;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.collections enable row level security;
alter table public.folders enable row level security;
alter table public.folder_members enable row level security;
alter table public.folder_teams enable row level security;
alter table public.assets enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.workspace_storage_limits enable row level security;
alter table public.asset_tags enable row level security;
alter table public.approval_requests enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.asset_transcripts enable row level security;
alter table public.activity_events enable row level security;

grant select, insert, update, delete on public.profiles, public.teams, public.team_members,
  public.collections, public.folders, public.folder_members, public.folder_teams,
  public.assets, public.upload_sessions, public.workspace_storage_limits,
  public.asset_tags, public.approval_requests, public.ai_jobs, public.asset_transcripts,
  public.activity_events to authenticated;
grant usage, select on sequence public.activity_events_id_seq to authenticated;

create policy "profiles readable by members" on public.profiles for select to authenticated using ((public.current_user_role() is not null and is_active) or id = (select auth.uid()));
-- Profile edits are server-managed until a column-restricted profile update flow exists.
create policy "admins manage profiles" on public.profiles for all to authenticated using (public.has_workspace_role(array['admin']::public.app_role[])) with check (public.has_workspace_role(array['admin']::public.app_role[]));
create policy "authenticated read teams" on public.teams for select to authenticated using (public.current_user_role() is not null);
create policy "admins manage teams" on public.teams for all to authenticated using (public.has_workspace_role(array['admin','manager']::public.app_role[])) with check (public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "members read team membership" on public.team_members for select to authenticated using (public.current_user_role() is not null and (user_id = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[])));
create policy "admins manage team membership" on public.team_members for all to authenticated using (public.has_workspace_role(array['admin','manager']::public.app_role[])) with check (public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "members read collections" on public.collections for select to authenticated using (public.current_user_role() is not null and not is_archived);
create policy "admins manage collections" on public.collections for all to authenticated using (public.has_workspace_role(array['admin','manager']::public.app_role[])) with check (public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "read accessible folders" on public.folders for select to authenticated using (public.can_access_folder(id));
create policy "admins manage folders" on public.folders for all to authenticated using (public.has_workspace_role(array['admin','manager']::public.app_role[])) with check (public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "read folder grants" on public.folder_members for select to authenticated using (public.current_user_role() is not null and (user_id = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[])));
create policy "admins manage folder grants" on public.folder_members for all to authenticated using (public.has_workspace_role(array['admin','manager']::public.app_role[])) with check (public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "read folder team grants" on public.folder_teams for select to authenticated using (public.current_user_role() is not null and public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "admins manage folder team grants" on public.folder_teams for all to authenticated using (public.has_workspace_role(array['admin','manager']::public.app_role[])) with check (public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "read accessible assets" on public.assets for select to authenticated using (public.current_user_role() is not null and deleted_at is null and (folder_id is null or public.can_access_folder(folder_id)) and (status in ('processing','approved') or uploaded_by = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[])));
create policy "contributors create assets" on public.assets for insert to authenticated with check (public.has_workspace_role(array['admin','manager','contributor','editor']::public.app_role[]) and (folder_id is null or public.can_upload_to_folder(folder_id)));
create policy "edit own unapproved or admin assets" on public.assets for update to authenticated using ((uploaded_by = (select auth.uid()) and status <> 'approved') or public.has_workspace_role(array['admin','manager']::public.app_role[])) with check ((uploaded_by = (select auth.uid()) and status <> 'approved') or public.has_workspace_role(array['admin','manager']::public.app_role[]));
create policy "admins delete assets" on public.assets for delete to authenticated using (public.has_workspace_role(array['admin']::public.app_role[]));
create policy "read own upload sessions" on public.upload_sessions for select to authenticated using (exists(select 1 from public.assets a where a.id = asset_id and (a.uploaded_by = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[]))));
create policy "update own upload sessions" on public.upload_sessions for update to authenticated using (exists(select 1 from public.assets a where a.id = asset_id and (a.uploaded_by = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[])))) with check (exists(select 1 from public.assets a where a.id = asset_id and (a.uploaded_by = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[]))));
create policy "read workspace storage limit" on public.workspace_storage_limits for select to authenticated using (true);
create policy "admins manage workspace storage limit" on public.workspace_storage_limits for update to authenticated using (public.has_workspace_role(array['admin']::public.app_role[])) with check (public.has_workspace_role(array['admin']::public.app_role[]));
create policy "read accessible asset tags" on public.asset_tags for select to authenticated using (exists(select 1 from public.assets a where a.id = asset_id));
create policy "contributors manage own asset tags" on public.asset_tags for all to authenticated using (exists(select 1 from public.assets a where a.id = asset_id and (a.uploaded_by = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[])))) with check (exists(select 1 from public.assets a where a.id = asset_id and (a.uploaded_by = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[]))));
create policy "read approvals by submitter or reviewer" on public.approval_requests for select to authenticated using (public.current_user_role() is not null and (requested_by = (select auth.uid()) or reviewer_id = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[])));
create policy "submit approval requests" on public.approval_requests for insert to authenticated with check (public.current_user_role() is not null and requested_by = (select auth.uid()) and exists(select 1 from public.assets a where a.id = asset_id and a.uploaded_by = (select auth.uid()) and a.status = 'pending_review'));
create policy "review assigned approvals" on public.approval_requests for update to authenticated using (public.current_user_role() is not null and (reviewer_id = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[]))) with check (public.current_user_role() is not null and (reviewer_id = (select auth.uid()) or public.has_workspace_role(array['admin','manager']::public.app_role[])));
create policy "read own ai jobs" on public.ai_jobs for select to authenticated using (exists(select 1 from public.assets a where a.id = asset_id));
create policy "read accessible transcripts" on public.asset_transcripts for select to authenticated using (exists(select 1 from public.assets a where a.id = asset_id));
create policy "read activity" on public.activity_events for select to authenticated using (public.current_user_role() is not null);

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger teams_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger collections_updated_at before update on public.collections for each row execute function public.set_updated_at();
create trigger folders_updated_at before update on public.folders for each row execute function public.set_updated_at();
create trigger assets_updated_at before update on public.assets for each row execute function public.set_updated_at();
create trigger approvals_updated_at before update on public.approval_requests for each row execute function public.set_updated_at();
create trigger upload_sessions_updated_at before update on public.upload_sessions for each row execute function public.set_updated_at();

revoke all on function public.reserve_upload_session(uuid, text, bigint, bigint) from public;
grant execute on function public.reserve_upload_session(uuid, text, bigint, bigint) to authenticated;
revoke all on function public.finalize_asset_upload(uuid) from public;
grant execute on function public.finalize_asset_upload(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), new.phone, 'New user'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
