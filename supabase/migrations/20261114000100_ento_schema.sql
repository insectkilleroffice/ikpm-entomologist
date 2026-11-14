-- =============================================================================
-- IKPM — ENTOMOLOGIST PORTAL (schema "ento")                     migration 1 of 2
-- =============================================================================
-- Shared Supabase project with ikpm-admin and ikpm-operation.
--
-- What already exists and is REUSED (not copied):
--   public.profiles            staff logins (this file adds the 'entomologist' role)
--   ops.clients                clients / companies
--   ops.sites                  branches / sites
--   ops.visits                 jobs (kinds monthly / contract / revisit are service jobs)
--   ops.service_reports        PCO completion reports (job_reports)
--   ops.inspection_reports     site inspections
--   ops.staff                  PCOs (field team)
--
-- What this file ADDS, in its own schema "ento" (nothing in ops/public is dropped):
--   site_access          which entomologist is authorized for which site (admin writes)
--   job_assignments      one row per completed job: assigned_to + verification_status
--   job_verifications    every Verify / Reject / Revisit decision (append-only)
--   complaints           complaints lodged by entomologists (+ complaint_updates)
--   activity_requests    revisit / inspection requests
--   meetings             admin-scheduled meetings (+ meeting_attendance)
--   notifications        in-app notifications
--   attachments          photos / documents in the private "ento-files" bucket
--   audit_log            verification and admin actions
--
-- Integration contract
--   * A completed job (ops.service_reports insert, written by Operations) creates the
--     job_assignments row with verification_status = 'pending' — see migration 2.
--     This portal never marks a job completed and nothing ever auto-verifies.
--   * activity_requests: this portal inserts status 'submitted'; only admin functions
--     write approved / rejected / scheduled_date / assigned_pco.
--   * complaints: this portal inserts and comments; admin functions write status.
--   * meetings: admin functions create / edit / cancel; this portal writes RSVP,
--     attendance and notes on the caller's own attendance row.
--   * Every write goes through a checked SECURITY DEFINER function. Tables have
--     SELECT policies only.
--
-- HOW TO RUN (once): Supabase → SQL Editor → paste this file → Run.
-- Then run 20261114000200_ento_ops_bridge.sql, and add "ento" to
-- Settings → API → Exposed schemas.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.profiles') is null or to_regprocedure('public.my_role()') is null then
    raise exception 'public.profiles / public.my_role() missing. Run ikpm-admin/supabase/fresh-start.sql first.';
  end if;
  if to_regclass('ops.visits') is null or to_regclass('ops.service_reports') is null then
    raise exception 'Schema "ops" missing. Run ikpm-admin/supabase/ops.sql first.';
  end if;
  if to_regnamespace('ento') is not null then
    raise exception 'Schema "ento" already exists. This migration runs once; to re-link after re-running ops.sql, run only 20261114000200_ento_ops_bridge.sql.';
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 0. The 'entomologist' role on staff profiles
-------------------------------------------------------------------------------
do $$
declare v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.profiles'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'operations', 'sales', 'finance', 'entomologist'));

-------------------------------------------------------------------------------
-- 1. Schema, enums, helpers
-------------------------------------------------------------------------------
create schema ento;
grant usage on schema ento to authenticated;
revoke all on schema ento from anon;

create type ento.verification_status   as enum ('pending', 'verified', 'rejected', 'revisit_requested');
create type ento.verification_decision as enum ('verified', 'rejected', 'revisit_requested');
create type ento.complaint_category    as enum ('poor_treatment_quality', 'pest_activity_present', 'client_dissatisfaction',
                                                'pco_performance', 'chemical_safety', 'site_hygiene', 'other');
create type ento.priority              as enum ('low', 'medium', 'high', 'critical');
create type ento.complaint_status      as enum ('submitted', 'under_review', 'assigned', 'in_progress', 'resolved', 'closed');
create type ento.request_type          as enum ('revisit', 'inspection');
create type ento.request_status        as enum ('submitted', 'approved', 'rejected', 'scheduled', 'completed', 'cancelled');
create type ento.meeting_status        as enum ('scheduled', 'rescheduled', 'cancelled', 'completed');
create type ento.rsvp_status           as enum ('pending', 'confirmed', 'declined');
create type ento.attendance_status     as enum ('unmarked', 'attended', 'absent');
create type ento.attachment_entity     as enum ('complaint', 'activity_request', 'job_verification');
create type ento.notification_kind     as enum (
  'job_assigned', 'job_returned', 'job_rejected', 'verifier_needed',
  'request_submitted', 'request_decided', 'request_scheduled', 'request_completed',
  'meeting_scheduled', 'meeting_changed', 'meeting_cancelled',
  'complaint_lodged', 'complaint_updated');

-- "Today" in Pakistan, the same for everyone.
create function ento.today()
returns date language sql stable
as $$ select (now() at time zone 'Asia/Karachi')::date $$;

create function ento.is_entomologist()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.my_role(), '') = 'entomologist' $$;

create function ento.me_name()
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(trim(p.full_name), ''), u.email, 'System')
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = auth.uid()
$$;

create function ento.require(p_roles text[], p_what text)
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null or not (coalesce(public.my_role(), '') = any (p_roles)) then
    raise exception 'Only % can %', array_to_string(p_roles, ' or '), p_what using errcode = '42501';
  end if;
end;
$$;

create function ento.touch()
returns trigger language plpgsql
as $$ begin new.updated_at := now(); return new; end; $$;

create function ento.forbid_change()
returns trigger language plpgsql
as $$
begin
  raise exception '% records are permanent and cannot be changed or deleted', tg_table_name using errcode = '42501';
end;
$$;

create function ento.clean(p text)
returns text language sql immutable
as $$ select nullif(trim(coalesce(p, '')), '') $$;

-------------------------------------------------------------------------------
-- 2. Tables
--    Every table: uuid PK, created_at, updated_at, created_by. assigned_to is the
--    person a row belongs to / is handled by, where that concept exists.
--    Links to ops.* are added (as foreign keys) by migration 2.
-------------------------------------------------------------------------------
create table ento.site_access (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null,                                                   -- ops.sites
  assigned_to uuid not null references public.profiles (id) on delete cascade, -- the entomologist
  is_primary  boolean not null default false,   -- receives this site's completed jobs
  active      boolean not null default true,
  created_by  uuid references auth.users (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (site_id, assigned_to)
);
create unique index site_access_one_primary on ento.site_access (site_id) where is_primary and active;
create index site_access_user_idx on ento.site_access (assigned_to) where active;

create table ento.job_assignments (
  id                  uuid primary key default gen_random_uuid(),
  visit_id            uuid not null unique,                                     -- ops.visits (the job)
  site_id             uuid not null,                                            -- ops.sites
  assigned_to         uuid references public.profiles (id) on delete set null,  -- entomologist who verifies
  verification_status ento.verification_status not null default 'pending',
  completed_at        timestamptz not null,       -- when the PCO completion report was filed
  round               integer not null default 1 check (round >= 1),  -- +1 each time it comes back after a rejection
  return_note         text,                       -- admin's note when returned for re-verification
  assigned_at         timestamptz,
  decided_at          timestamptz,
  created_by          uuid references auth.users (id),
  created_by_name     text not null default 'System',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index job_assignments_mine_idx   on ento.job_assignments (assigned_to, verification_status);
create index job_assignments_site_idx   on ento.job_assignments (site_id);
create index job_assignments_status_idx on ento.job_assignments (verification_status, completed_at desc);

create table ento.job_verifications (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references ento.job_assignments (id) on delete restrict,
  visit_id      uuid not null,                                     -- ops.visits
  round         integer not null,
  decision      ento.verification_decision not null,
  remarks       text,
  reason        text,                                              -- required to reject / request revisit
  treatment_ok  boolean,
  chemicals_ok  boolean,
  photos_ok     boolean,
  report_ok     boolean,
  pest_activity text check (pest_activity in ('none', 'low', 'medium', 'high')),
  created_by    uuid not null references auth.users (id),          -- verifier id
  verifier_name text not null,
  created_at    timestamptz not null default now(),                -- decision timestamp
  updated_at    timestamptz not null default now(),
  unique (assignment_id, round),
  constraint rejected_needs_reason check (decision <> 'rejected' or length(trim(coalesce(reason, ''))) >= 10),
  constraint revisit_needs_reason  check (decision <> 'revisit_requested' or length(trim(coalesce(reason, ''))) > 0)
);
create index job_verifications_visit_idx    on ento.job_verifications (visit_id, created_at desc);
create index job_verifications_verifier_idx on ento.job_verifications (created_by, created_at desc);

create sequence ento.complaint_seq start 1001;
create table ento.complaints (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default ('EC-' || nextval('ento.complaint_seq')),
  client_id       uuid not null,                     -- ops.clients
  site_id         uuid not null,                     -- ops.sites
  visit_id        uuid,                              -- ops.visits (related job, optional)
  category        ento.complaint_category not null,
  description     text not null check (length(trim(description)) >= 10),
  priority        ento.priority not null,
  status          ento.complaint_status not null default 'submitted',
  created_by      uuid not null references auth.users (id),
  created_by_name text not null,
  assigned_to     uuid references public.profiles (id) on delete set null,  -- admin / operations handler
  resolved_at     timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),   -- submission date
  updated_at      timestamptz not null default now()
);
create index complaints_owner_idx  on ento.complaints (created_by, created_at desc);
create index complaints_site_idx   on ento.complaints (site_id, created_at desc);
create index complaints_status_idx on ento.complaints (status);

create table ento.complaint_updates (
  id           uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references ento.complaints (id) on delete cascade,
  kind         text not null check (kind in ('comment', 'status', 'response')),
  from_status  ento.complaint_status,
  to_status    ento.complaint_status,
  message      text,
  created_by   uuid references auth.users (id),
  author_name  text not null,
  author_role  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint status_change_has_status check (kind <> 'status' or to_status is not null),
  constraint text_has_message check (kind = 'status' or length(trim(coalesce(message, ''))) > 0)
);
create index complaint_updates_idx on ento.complaint_updates (complaint_id, created_at);

create sequence ento.request_seq start 1001;
create table ento.activity_requests (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique default ('REQ-' || nextval('ento.request_seq')),
  type               ento.request_type not null,
  client_id          uuid not null,                  -- ops.clients
  site_id            uuid not null,                  -- ops.sites
  visit_id           uuid,                           -- ops.visits: previous job (revisit)
  reason             text,                           -- revisit: reason
  purpose            text,                           -- inspection: purpose
  description        text not null check (length(trim(description)) >= 10),  -- pest activity / observations
  priority           ento.priority not null,
  recommended_date   date not null,
  status             ento.request_status not null default 'submitted',
  -- written by admin only
  decision_note      text,
  decided_by         uuid references auth.users (id),
  decided_by_name    text,
  decided_at         timestamptz,
  scheduled_date     date,
  scheduled_time     text check (scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  assigned_pco       uuid,                           -- ops.staff
  scheduled_visit_id uuid unique,                    -- ops.visits created for it
  --
  created_by         uuid not null references auth.users (id),
  created_by_name    text not null,
  assigned_to        uuid references public.profiles (id) on delete set null,  -- admin handling it
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint revisit_fields       check (type <> 'revisit' or (visit_id is not null and length(trim(coalesce(reason, ''))) > 0)),
  constraint inspection_fields    check (type <> 'inspection' or length(trim(coalesce(purpose, ''))) > 0),
  constraint rejected_needs_note  check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) > 0),
  constraint scheduled_has_visit  check (status not in ('scheduled', 'completed')
                                         or (scheduled_date is not null and scheduled_time is not null and scheduled_visit_id is not null))
);
create index activity_requests_owner_idx  on ento.activity_requests (created_by, created_at desc);
create index activity_requests_site_idx   on ento.activity_requests (site_id, created_at desc);
create index activity_requests_status_idx on ento.activity_requests (status);
create index activity_requests_visit_idx  on ento.activity_requests (visit_id);

create table ento.meetings (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(trim(title)) > 0),
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  location          text,
  online_link       text check (online_link is null or online_link ~* '^https?://'),
  agenda            text,
  status            ento.meeting_status not null default 'scheduled',
  cancel_reason     text,
  created_by        uuid references auth.users (id),
  scheduled_by_name text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ends_after_start check (ends_at is null or ends_at > starts_at),
  constraint has_place check (length(trim(coalesce(location, ''))) > 0 or online_link is not null),
  constraint cancel_has_reason check (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) > 0)
);
create index meetings_starts_idx on ento.meetings (starts_at);

create table ento.meeting_attendance (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references ento.meetings (id) on delete cascade,
  assigned_to   uuid not null references public.profiles (id) on delete cascade,  -- attendee
  rsvp          ento.rsvp_status not null default 'pending',
  rsvp_at       timestamptz,
  attendance    ento.attendance_status not null default 'unmarked',
  attendance_at timestamptz,
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (meeting_id, assigned_to)
);
create index meeting_attendance_user_idx on ento.meeting_attendance (assigned_to);

create table ento.notifications (
  id          uuid primary key default gen_random_uuid(),
  assigned_to uuid not null references public.profiles (id) on delete cascade,  -- recipient
  kind        ento.notification_kind not null,
  title       text not null,
  body        text,
  link        text,                 -- path in the entomologist portal (null for admin / ops recipients)
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index notifications_user_idx   on ento.notifications (assigned_to, created_at desc);
create index notifications_unread_idx on ento.notifications (assigned_to) where read_at is null;

create table ento.attachments (
  id          uuid primary key default gen_random_uuid(),
  entity_type ento.attachment_entity not null,
  entity_id   uuid not null,
  bucket      text not null default 'ento-files',
  path        text not null unique,
  file_name   text not null,
  mime_type   text not null check (mime_type ~ '^(image/[a-z0-9.+-]+|application/pdf)$'),
  size_bytes  integer not null check (size_bytes between 1 and 10485760),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index attachments_entity_idx on ento.attachments (entity_type, entity_id);

create table ento.audit_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  actor_name  text not null,
  actor_role  text,
  created_by  uuid references auth.users (id),   -- actor
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index audit_log_entity_idx on ento.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_actor_idx  on ento.audit_log (created_by, created_at desc);

-- updated_at on every table; permanent tables cannot change.
do $$
declare t text;
begin
  foreach t in array array['site_access', 'job_assignments', 'complaints', 'complaint_updates', 'activity_requests',
                           'meetings', 'meeting_attendance', 'notifications', 'attachments'] loop
    execute format('create trigger %I before update on ento.%I for each row execute function ento.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['job_verifications', 'audit_log'] loop
    execute format('create trigger %I before update or delete on ento.%I for each row execute function ento.forbid_change()', t || '_permanent', t);
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- 3. Access helpers
-------------------------------------------------------------------------------
-- Can the caller see this site? admin: all · operations: sites they manage ·
-- entomologist: sites they are authorized for.
create function ento.can_see_site(p_site_id uuid)
returns boolean language plpgsql stable security definer set search_path = ento, ops, public
as $$
begin
  case coalesce(public.my_role(), '')
    when 'admin' then return true;
    when 'operations' then
      return exists (select 1 from ops.sites s where s.id = p_site_id and s.manager_id = auth.uid());
    when 'entomologist' then
      return exists (select 1 from ento.site_access a where a.site_id = p_site_id and a.assigned_to = auth.uid() and a.active);
    else return false;
  end case;
end;
$$;

-- Admin, or the operations manager of that site.
create function ento.can_manage_site(p_site_id uuid)
returns boolean language plpgsql stable security definer set search_path = ento, ops, public
as $$
begin
  return coalesce(public.my_role(), '') = 'admin'
      or (coalesce(public.my_role(), '') = 'operations'
          and exists (select 1 from ops.sites s where s.id = p_site_id and s.manager_id = auth.uid()));
end;
$$;

create function ento.audit(p_action text, p_entity_type text, p_entity_id uuid, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = ento, public
as $$
begin
  insert into ento.audit_log (action, entity_type, entity_id, before, after, actor_name, actor_role, created_by)
  values (p_action, p_entity_type, p_entity_id, p_before, p_after,
          coalesce(ento.me_name(), 'System'), public.my_role(), auth.uid());
end;
$$;

create function ento.notify(p_to uuid, p_kind ento.notification_kind, p_title text, p_body text,
                            p_link text, p_entity_type text, p_entity_id uuid)
returns void language plpgsql security definer set search_path = ento, public
as $$
begin
  if p_to is null then return; end if;
  insert into ento.notifications (assigned_to, kind, title, body, link, entity_type, entity_id, created_by)
  values (p_to, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id, auth.uid());
end;
$$;

-- Tell every admin and the site's operations manager (Admin / Operations side).
create function ento.notify_staff(p_site_id uuid, p_kind ento.notification_kind, p_title text, p_body text,
                                  p_entity_type text, p_entity_id uuid)
returns void language plpgsql security definer set search_path = ento, ops, public
as $$
declare v_id uuid;
begin
  for v_id in
    select id from public.profiles where role = 'admin'
    union
    select manager_id from ops.sites where id = p_site_id and manager_id is not null
  loop
    if v_id is distinct from auth.uid() then
      perform ento.notify(v_id, p_kind, p_title, p_body, null, p_entity_type, p_entity_id);
    end if;
  end loop;
end;
$$;

-- Records files the caller already uploaded to ento-files/<their user id>/…
-- p_files = [{ "path": "<uid>/complaints/…jpg", "name": "IMG_01.jpg", "type": "image/jpeg", "size": 123456 }]
create function ento.attach(p_entity_type ento.attachment_entity, p_entity_id uuid, p_files jsonb)
returns void language plpgsql security definer set search_path = ento, storage, public
as $$
declare
  f      jsonb;
  v_path text;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then return; end if;
  if jsonb_array_length(p_files) > 6 then
    raise exception 'Attach at most 6 files' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(p_files) loop
    v_path := f ->> 'path';
    if v_path is null or v_path not like auth.uid()::text || '/%' or v_path like '%..%' then
      raise exception 'Invalid file path' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ento-files' and o.name = v_path) then
      raise exception 'File % was not uploaded', coalesce(f ->> 'name', v_path) using errcode = '22023';
    end if;
    insert into ento.attachments (entity_type, entity_id, path, file_name, mime_type, size_bytes, created_by)
    values (p_entity_type, p_entity_id, v_path,
            left(coalesce(ento.clean(f ->> 'name'), 'file'), 200),
            lower(coalesce(f ->> 'type', '')),
            coalesce((f ->> 'size')::integer, 0),
            auth.uid());
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- 4. Row security — SELECT only. Writes go through the functions below.
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['site_access', 'job_assignments', 'job_verifications', 'complaints', 'complaint_updates',
                           'activity_requests', 'meetings', 'meeting_attendance', 'notifications', 'attachments',
                           'audit_log'] loop
    execute format('alter table ento.%I enable row level security', t);
    execute format('revoke all on ento.%I from anon, authenticated', t);
    execute format('grant select on ento.%I to authenticated', t);
  end loop;
end;
$$;

create policy "Own access rows, admin, or the site manager" on ento.site_access
  for select to authenticated
  using (assigned_to = auth.uid() or ento.can_manage_site(site_id));

-- Entomologists: jobs assigned to them + the job history of sites they are authorized for.
create policy "Assigned or visible site" on ento.job_assignments
  for select to authenticated
  using (assigned_to = auth.uid() or ento.can_see_site(site_id));

create policy "With the assignment" on ento.job_verifications
  for select to authenticated
  using (exists (select 1 from ento.job_assignments a where a.id = assignment_id));

-- Entomologists see only their own complaints and requests; admin / site manager see theirs to handle.
create policy "Own, or handled by admin / site manager" on ento.complaints
  for select to authenticated
  using (created_by = auth.uid() or ento.can_manage_site(site_id));

create policy "With the complaint" on ento.complaint_updates
  for select to authenticated
  using (exists (select 1 from ento.complaints c where c.id = complaint_id));

create policy "Own, or handled by admin / site manager" on ento.activity_requests
  for select to authenticated
  using (created_by = auth.uid() or ento.can_manage_site(site_id));

create policy "Invited or admin" on ento.meetings
  for select to authenticated
  using (public.my_role() = 'admin'
         or exists (select 1 from ento.meeting_attendance a where a.meeting_id = meetings.id and a.assigned_to = auth.uid()));

create policy "Own attendance or admin" on ento.meeting_attendance
  for select to authenticated
  using (assigned_to = auth.uid() or public.my_role() = 'admin');

create policy "Own notifications" on ento.notifications
  for select to authenticated
  using (assigned_to = auth.uid());

-- A file is visible when the record it belongs to is visible (those tables' policies apply).
create policy "With the record" on ento.attachments
  for select to authenticated
  using (case entity_type
           when 'complaint'        then exists (select 1 from ento.complaints c where c.id = entity_id)
           when 'activity_request' then exists (select 1 from ento.activity_requests r where r.id = entity_id)
           when 'job_verification' then exists (select 1 from ento.job_verifications v where v.id = entity_id)
         end);

create policy "Admin reads the audit log" on ento.audit_log
  for select to authenticated
  using (public.my_role() = 'admin');

-------------------------------------------------------------------------------
-- 5. Notification triggers
-------------------------------------------------------------------------------
-- A job handed to an entomologist (on completion, or re-assigned by admin).
create function ento.tg_assignment_notify()
returns trigger language plpgsql security definer set search_path = ento, ops, public
as $$
declare v_label text;
begin
  if new.assigned_to is null then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  select coalesce(v.job_code, 'Job') || ' · ' || s.name into v_label
    from ops.visits v join ops.sites s on s.id = v.site_id where v.id = new.visit_id;
  perform ento.notify(new.assigned_to, 'job_assigned', 'Job ready for verification',
                      coalesce(v_label, 'A completed job') || ' was completed and needs your verification.',
                      '/jobs/' || new.visit_id, 'job', new.visit_id);
  return new;
end;
$$;
create trigger job_assignments_notify after insert or update of assigned_to on ento.job_assignments
  for each row execute function ento.tg_assignment_notify();

-- Admin / ops answered a complaint → tell the entomologist who lodged it.
create function ento.tg_complaint_update_notify()
returns trigger language plpgsql security definer set search_path = ento, public
as $$
declare c ento.complaints%rowtype;
begin
  select * into c from ento.complaints where id = new.complaint_id;
  if c.created_by is distinct from new.created_by then
    perform ento.notify(c.created_by, 'complaint_updated',
      'Update on complaint ' || c.code,
      case when new.kind = 'status' then 'Status changed to ' || replace(new.to_status::text, '_', ' ')
                                         || coalesce(': ' || new.message, '')
           else new.message end,
      '/complaints/' || c.id, 'complaint', c.id);
  end if;
  return new;
end;
$$;
create trigger complaint_updates_notify after insert on ento.complaint_updates
  for each row execute function ento.tg_complaint_update_notify();

-- Request approved / rejected / scheduled / completed → tell the requester.
create function ento.tg_request_status_notify()
returns trigger language plpgsql security definer set search_path = ento, public
as $$
declare v_kind ento.notification_kind; v_title text; v_body text;
begin
  if new.status is not distinct from old.status then return new; end if;
  case new.status
    when 'approved'  then v_kind := 'request_decided';   v_title := new.code || ' approved';
                          v_body := coalesce(new.decision_note, 'Admin approved your ' || new.type || ' request.');
    when 'rejected'  then v_kind := 'request_decided';   v_title := new.code || ' rejected';
                          v_body := new.decision_note;
    when 'scheduled' then v_kind := 'request_scheduled'; v_title := new.code || ' scheduled';
                          v_body := 'Scheduled for ' || to_char(new.scheduled_date, 'DD Mon YYYY') || ' at ' || new.scheduled_time || '.';
    when 'completed' then v_kind := 'request_completed'; v_title := new.code || ' completed';
                          v_body := 'The ' || new.type || ' has been carried out.';
    else return new;
  end case;
  perform ento.notify(new.created_by, v_kind, v_title, v_body, '/requests/' || new.id, 'activity_request', new.id);
  return new;
end;
$$;
create trigger activity_requests_notify after update of status on ento.activity_requests
  for each row execute function ento.tg_request_status_notify();

-- Invited to a meeting.
create function ento.tg_attendance_notify()
returns trigger language plpgsql security definer set search_path = ento, public
as $$
declare m ento.meetings%rowtype;
begin
  select * into m from ento.meetings where id = new.meeting_id;
  perform ento.notify(new.assigned_to, 'meeting_scheduled', 'New meeting: ' || m.title,
    to_char(m.starts_at at time zone 'Asia/Karachi', 'Dy DD Mon, HH24:MI') || ' · ' || coalesce(ento.clean(m.location), 'Online'),
    '/meetings/' || m.id, 'meeting', m.id);
  return new;
end;
$$;
create trigger meeting_attendance_notify after insert on ento.meeting_attendance
  for each row execute function ento.tg_attendance_notify();

-- Meeting moved, changed or cancelled.
create function ento.tg_meeting_change_notify()
returns trigger language plpgsql security definer set search_path = ento, public
as $$
declare v_who uuid; v_kind ento.notification_kind; v_title text; v_body text;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    v_kind := 'meeting_cancelled'; v_title := 'Meeting cancelled: ' || new.title; v_body := new.cancel_reason;
  elsif (new.starts_at, new.ends_at, new.location, new.online_link, new.title, new.agenda)
        is distinct from (old.starts_at, old.ends_at, old.location, old.online_link, old.title, old.agenda) then
    v_kind := 'meeting_changed'; v_title := 'Meeting updated: ' || new.title;
    v_body := to_char(new.starts_at at time zone 'Asia/Karachi', 'Dy DD Mon, HH24:MI') || ' · ' || coalesce(ento.clean(new.location), 'Online');
  else
    return new;
  end if;
  for v_who in select assigned_to from ento.meeting_attendance where meeting_id = new.id loop
    perform ento.notify(v_who, v_kind, v_title, v_body, '/meetings/' || new.id, 'meeting', new.id);
  end loop;
  return new;
end;
$$;
create trigger meetings_notify after update on ento.meetings
  for each row execute function ento.tg_meeting_change_notify();

-------------------------------------------------------------------------------
-- 6. Entomologist functions
-------------------------------------------------------------------------------
-- Verify or reject a job assigned to me. Every decision is a permanent row with
-- verifier id, timestamp, decision and remarks.
--   p_decision: 'verified' | 'rejected'   (revisits go through submit_request)
--   p_checks:   { "treatment": true, "chemicals": true, "photos": true, "report": true }
create function ento.decide_job(
  p_assignment_id uuid,
  p_decision      text,
  p_remarks       text default null,
  p_reason        text default null,
  p_checks        jsonb default '{}'::jsonb,
  p_pest_activity text default null,
  p_files         jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = ento, ops, public
as $$
declare
  a      ento.job_assignments%rowtype;
  v_id   uuid;
  v_job  text;
  v_reason text := ento.clean(p_reason);
begin
  perform ento.require(array['entomologist'], 'verify jobs');
  if coalesce(p_decision, '') not in ('verified', 'rejected') then
    raise exception 'Choose Verify or Reject' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and length(coalesce(v_reason, '')) < 10 then
    raise exception 'Write the reason for rejecting (at least 10 characters)' using errcode = '22023';
  end if;
  if p_pest_activity is not null and p_pest_activity not in ('none', 'low', 'medium', 'high') then
    raise exception 'Pick the pest activity level' using errcode = '22023';
  end if;

  select * into a from ento.job_assignments where id = p_assignment_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if a.assigned_to is distinct from auth.uid() then
    raise exception 'This job is assigned to another entomologist' using errcode = '42501';
  end if;
  if not ento.can_see_site(a.site_id) then
    raise exception 'You are not authorized for this site' using errcode = '42501';
  end if;
  if a.verification_status <> 'pending' then
    raise exception 'This job was already % ', replace(a.verification_status::text, '_', ' ') using errcode = '22023';
  end if;
  if not exists (select 1 from ops.service_reports where visit_id = a.visit_id) then
    raise exception 'The PCO completion report is missing' using errcode = '22023';
  end if;

  insert into ento.job_verifications (assignment_id, visit_id, round, decision, remarks, reason,
                                      treatment_ok, chemicals_ok, photos_ok, report_ok, pest_activity,
                                      created_by, verifier_name)
  values (a.id, a.visit_id, a.round, p_decision::ento.verification_decision, ento.clean(p_remarks), v_reason,
          (p_checks ->> 'treatment')::boolean, (p_checks ->> 'chemicals')::boolean,
          (p_checks ->> 'photos')::boolean, (p_checks ->> 'report')::boolean, p_pest_activity,
          auth.uid(), ento.me_name())
  returning id into v_id;

  update ento.job_assignments
     set verification_status = p_decision::ento.verification_status, decided_at = now()
   where id = a.id;

  perform ento.attach('job_verification', v_id, p_files);
  perform ento.audit('job.' || p_decision, 'job_assignment', a.id,
                     jsonb_build_object('verification_status', a.verification_status, 'round', a.round),
                     jsonb_build_object('verification_status', p_decision, 'verification_id', v_id,
                                        'remarks', ento.clean(p_remarks), 'reason', v_reason));

  if p_decision = 'rejected' then
    select job_code into v_job from ops.visits where id = a.visit_id;
    perform ento.notify_staff(a.site_id, 'job_rejected', 'Job ' || coalesce(v_job, '') || ' rejected by entomologist',
                              v_reason, 'job', a.visit_id);
  end if;
  return v_id;
end;
$$;

-- Revisit or inspection request. Status starts 'submitted'; only admin moves it on.
create function ento.submit_request(
  p_type             text,
  p_site_id          uuid,
  p_visit_id         uuid,
  p_reason           text,
  p_purpose          text,
  p_description      text,
  p_priority         text,
  p_recommended_date date,
  p_files            jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = ento, ops, public
as $$
declare
  v_client uuid;
  v_id     uuid;
  v_code   text;
  v_site   text;
  a        ento.job_assignments%rowtype;
begin
  perform ento.require(array['entomologist'], 'submit revisit or inspection requests');
  if coalesce(p_type, '') not in ('revisit', 'inspection') then
    raise exception 'Choose revisit or inspection' using errcode = '22023';
  end if;
  select client_id, name into v_client, v_site from ops.sites where id = p_site_id;
  if v_client is null then raise exception 'Pick the branch / site' using errcode = '22023'; end if;
  if not ento.can_see_site(p_site_id) then
    raise exception 'You are not authorized for this site' using errcode = '42501';
  end if;
  if p_type = 'revisit' then
    if p_visit_id is null then raise exception 'Pick the previous job' using errcode = '22023'; end if;
    if not exists (select 1 from ops.visits where id = p_visit_id and site_id = p_site_id
                     and kind in ('monthly', 'contract', 'revisit')) then
      raise exception 'That job is not at this site' using errcode = '22023';
    end if;
    if ento.clean(p_reason) is null then raise exception 'Write the reason for the revisit' using errcode = '22023'; end if;
  else
    if ento.clean(p_purpose) is null then raise exception 'Write the inspection purpose' using errcode = '22023'; end if;
    if p_visit_id is not null and not exists (select 1 from ops.visits where id = p_visit_id and site_id = p_site_id) then
      raise exception 'That job is not at this site' using errcode = '22023';
    end if;
  end if;
  if length(coalesce(ento.clean(p_description), '')) < 10 then
    raise exception 'Describe the problem / observations (at least 10 characters)' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Pick the priority' using errcode = '22023';
  end if;
  if p_recommended_date is null or p_recommended_date < ento.today() then
    raise exception 'Recommended date must be today or later' using errcode = '22023';
  end if;

  insert into ento.activity_requests (type, client_id, site_id, visit_id, reason, purpose, description, priority,
                                      recommended_date, created_by, created_by_name)
  values (p_type::ento.request_type, v_client, p_site_id, p_visit_id,
          case when p_type = 'revisit' then ento.clean(p_reason) end,
          case when p_type = 'inspection' then ento.clean(p_purpose) end,
          ento.clean(p_description), p_priority::ento.priority, p_recommended_date, auth.uid(), ento.me_name())
  returning id, code into v_id, v_code;

  perform ento.attach('activity_request', v_id, p_files);

  -- A revisit requested on a job still waiting for my verification is my decision on that job.
  if p_type = 'revisit' then
    select * into a from ento.job_assignments
     where visit_id = p_visit_id and assigned_to = auth.uid() and verification_status = 'pending' for update;
    if found then
      insert into ento.job_verifications (assignment_id, visit_id, round, decision, remarks, reason, created_by, verifier_name)
      values (a.id, a.visit_id, a.round, 'revisit_requested', 'Revisit request ' || v_code, ento.clean(p_reason),
              auth.uid(), ento.me_name());
      update ento.job_assignments set verification_status = 'revisit_requested', decided_at = now() where id = a.id;
      perform ento.audit('job.revisit_requested', 'job_assignment', a.id,
                         jsonb_build_object('verification_status', 'pending'),
                         jsonb_build_object('verification_status', 'revisit_requested', 'request_id', v_id));
    end if;
  end if;

  perform ento.audit('request.submitted', 'activity_request', v_id, null,
                     jsonb_build_object('code', v_code, 'type', p_type, 'site_id', p_site_id, 'visit_id', p_visit_id));
  perform ento.notify_staff(p_site_id, 'request_submitted', 'New ' || p_type || ' request ' || v_code,
                            v_site || ': ' || ento.clean(p_description), 'activity_request', v_id);
  return v_id;
end;
$$;

-- Withdraw my own request while admin has not decided yet.
create function ento.cancel_request(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = ento, public
as $$
declare r ento.activity_requests%rowtype;
begin
  perform ento.require(array['entomologist'], 'withdraw requests');
  select * into r from ento.activity_requests where id = p_id for update;
  if not found or r.created_by <> auth.uid() then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then
    raise exception 'Admin already acted on this request; it can no longer be withdrawn' using errcode = '22023';
  end if;
  update ento.activity_requests set status = 'cancelled', decision_note = coalesce(ento.clean(p_note), 'Withdrawn by requester')
   where id = p_id;
  perform ento.audit('request.cancelled', 'activity_request', p_id, jsonb_build_object('status', r.status),
                     jsonb_build_object('status', 'cancelled'));
end;
$$;

create function ento.lodge_complaint(
  p_site_id     uuid,
  p_visit_id    uuid,
  p_category    text,
  p_description text,
  p_priority    text,
  p_files       jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = ento, ops, public
as $$
declare v_client uuid; v_site text; v_id uuid; v_code text;
begin
  perform ento.require(array['entomologist'], 'lodge complaints');
  select client_id, name into v_client, v_site from ops.sites where id = p_site_id;
  if v_client is null then raise exception 'Pick the branch / site' using errcode = '22023'; end if;
  if not ento.can_see_site(p_site_id) then
    raise exception 'You are not authorized for this site' using errcode = '42501';
  end if;
  if p_visit_id is not null and not exists (select 1 from ops.visits where id = p_visit_id and site_id = p_site_id) then
    raise exception 'That job is not at this site' using errcode = '22023';
  end if;
  if coalesce(p_category, '') not in ('poor_treatment_quality', 'pest_activity_present', 'client_dissatisfaction',
                                      'pco_performance', 'chemical_safety', 'site_hygiene', 'other') then
    raise exception 'Pick the category' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Pick the priority' using errcode = '22023';
  end if;
  if length(coalesce(ento.clean(p_description), '')) < 10 then
    raise exception 'Describe the complaint (at least 10 characters)' using errcode = '22023';
  end if;

  insert into ento.complaints (client_id, site_id, visit_id, category, description, priority, created_by, created_by_name)
  values (v_client, p_site_id, p_visit_id, p_category::ento.complaint_category, ento.clean(p_description),
          p_priority::ento.priority, auth.uid(), ento.me_name())
  returning id, code into v_id, v_code;

  insert into ento.complaint_updates (complaint_id, kind, to_status, message, created_by, author_name, author_role)
  values (v_id, 'status', 'submitted', null, auth.uid(), ento.me_name(), 'entomologist');

  perform ento.attach('complaint', v_id, p_files);
  perform ento.audit('complaint.lodged', 'complaint', v_id, null,
                     jsonb_build_object('code', v_code, 'site_id', p_site_id, 'priority', p_priority, 'category', p_category));
  perform ento.notify_staff(p_site_id, 'complaint_lodged', 'Complaint ' || v_code || ' (' || p_priority || ')',
                            v_site || ': ' || ento.clean(p_description), 'complaint', v_id);
  return v_id;
end;
$$;

-- Add a note to my own complaint (until it is closed).
create function ento.comment_complaint(p_id uuid, p_message text)
returns void
language plpgsql security definer set search_path = ento, public
as $$
declare c ento.complaints%rowtype;
begin
  perform ento.require(array['entomologist'], 'comment on complaints');
  select * into c from ento.complaints where id = p_id;
  if not found or c.created_by <> auth.uid() then raise exception 'Complaint not found' using errcode = 'P0002'; end if;
  if c.status = 'closed' then raise exception 'This complaint is closed' using errcode = '22023'; end if;
  if ento.clean(p_message) is null then raise exception 'Write a message' using errcode = '22023'; end if;
  insert into ento.complaint_updates (complaint_id, kind, message, created_by, author_name, author_role)
  values (p_id, 'comment', left(ento.clean(p_message), 4000), auth.uid(), ento.me_name(), 'entomologist');
  perform ento.notify_staff(c.site_id, 'complaint_updated', 'New note on complaint ' || c.code,
                            ento.clean(p_message), 'complaint', c.id);
end;
$$;

-- RSVP, attendance and notes on my own attendance row.
--   p_rsvp: 'confirmed' | 'declined' | null (keep) · p_attendance: 'attended' | 'absent' | null (keep)
create function ento.respond_meeting(p_meeting_id uuid, p_rsvp text default null, p_attendance text default null,
                                     p_notes text default null)
returns void
language plpgsql security definer set search_path = ento, public
as $$
declare m ento.meetings%rowtype; a ento.meeting_attendance%rowtype;
begin
  perform ento.require(array['entomologist'], 'respond to meetings');
  select * into a from ento.meeting_attendance where meeting_id = p_meeting_id and assigned_to = auth.uid() for update;
  if not found then raise exception 'You are not invited to this meeting' using errcode = 'P0002'; end if;
  select * into m from ento.meetings where id = p_meeting_id;
  if m.status = 'cancelled' then raise exception 'This meeting was cancelled' using errcode = '22023'; end if;
  if p_rsvp is not null and p_rsvp not in ('confirmed', 'declined') then
    raise exception 'Choose confirm or decline' using errcode = '22023';
  end if;
  if p_attendance is not null then
    if p_attendance not in ('attended', 'absent') then
      raise exception 'Choose attended or absent' using errcode = '22023';
    end if;
    if now() < m.starts_at - interval '30 minutes' then
      raise exception 'Attendance can be marked from 30 minutes before the meeting starts' using errcode = '22023';
    end if;
  end if;
  update ento.meeting_attendance
     set rsvp          = coalesce(p_rsvp::ento.rsvp_status, rsvp),
         rsvp_at       = case when p_rsvp is not null then now() else rsvp_at end,
         attendance    = coalesce(p_attendance::ento.attendance_status, attendance),
         attendance_at = case when p_attendance is not null then now() else attendance_at end,
         notes         = case when p_notes is not null then left(ento.clean(p_notes), 4000) else notes end
   where id = a.id;
end;
$$;

-- Mark my notifications read: p_ids = null marks all.
create function ento.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql security definer set search_path = ento, public
as $$
  update ento.notifications set read_at = now()
   where assigned_to = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

-------------------------------------------------------------------------------
-- 7. Admin / Operations functions (called from the Admin / Operations portals)
-------------------------------------------------------------------------------
-- Authorize (or remove) an entomologist for a site. Primary = gets its completed jobs.
create function ento.admin_set_site_access(p_site_id uuid, p_entomologist_id uuid, p_primary boolean, p_active boolean)
returns void
language plpgsql security definer set search_path = ento, ops, public
as $$
begin
  perform ento.require(array['admin'], 'authorize entomologists for sites');
  if not exists (select 1 from ops.sites where id = p_site_id) then raise exception 'Site not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_entomologist_id and role = 'entomologist') then
    raise exception 'That person is not an entomologist' using errcode = '22023';
  end if;
  if coalesce(p_primary, false) and coalesce(p_active, true) then
    update ento.site_access set is_primary = false where site_id = p_site_id and assigned_to <> p_entomologist_id and is_primary;
  end if;
  insert into ento.site_access (site_id, assigned_to, is_primary, active, created_by)
  values (p_site_id, p_entomologist_id, coalesce(p_primary, false) and coalesce(p_active, true), coalesce(p_active, true), auth.uid())
  on conflict (site_id, assigned_to) do update
     set is_primary = excluded.is_primary, active = excluded.active;
  perform ento.audit('site_access.set', 'site', p_site_id, null,
                     jsonb_build_object('entomologist_id', p_entomologist_id, 'primary', p_primary, 'active', p_active));
end;
$$;

-- Give (or move) a completed job's verification to an entomologist authorized for the site.
create function ento.admin_assign_verifier(p_visit_id uuid, p_entomologist_id uuid)
returns void
language plpgsql security definer set search_path = ento, ops, public
as $$
declare v ops.visits%rowtype; r ops.service_reports%rowtype; a ento.job_assignments%rowtype;
begin
  select * into v from ops.visits where id = p_visit_id;
  if not found or v.site_id is null then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if not ento.can_manage_site(v.site_id) then
    raise exception 'Only admin or this site''s operations manager can assign the verifier' using errcode = '42501';
  end if;
  select * into r from ops.service_reports where visit_id = p_visit_id;
  if not found then raise exception 'The job is not completed yet' using errcode = '22023'; end if;
  if not exists (select 1 from ento.site_access where site_id = v.site_id and assigned_to = p_entomologist_id and active) then
    raise exception 'That entomologist is not authorized for this site' using errcode = '22023';
  end if;
  select * into a from ento.job_assignments where visit_id = p_visit_id for update;
  if found and a.verification_status <> 'pending' then
    raise exception 'This job was already decided; return it for verification instead' using errcode = '22023';
  end if;
  insert into ento.job_assignments (visit_id, site_id, assigned_to, completed_at, assigned_at, created_by, created_by_name)
  values (p_visit_id, v.site_id, p_entomologist_id, r.submitted_at, now(), auth.uid(), ento.me_name())
  on conflict (visit_id) do update set assigned_to = excluded.assigned_to, assigned_at = now();
  perform ento.audit('job.assign_verifier', 'job', p_visit_id,
                     case when a.id is not null then jsonb_build_object('assigned_to', a.assigned_to) end,
                     jsonb_build_object('assigned_to', p_entomologist_id));
end;
$$;

-- After a rejection is corrected: send the job back to the entomologist (next round).
create function ento.admin_return_for_verification(p_assignment_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = ento, ops, public
as $$
declare a ento.job_assignments%rowtype; v_job text;
begin
  select * into a from ento.job_assignments where id = p_assignment_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if not ento.can_manage_site(a.site_id) then
    raise exception 'Only admin or this site''s operations manager can return a job' using errcode = '42501';
  end if;
  if a.verification_status <> 'rejected' then
    raise exception 'Only rejected jobs can be returned for verification' using errcode = '22023';
  end if;
  if ento.clean(p_note) is null then raise exception 'Write what was corrected' using errcode = '22023'; end if;
  update ento.job_assignments
     set verification_status = 'pending', round = round + 1, return_note = ento.clean(p_note), decided_at = null
   where id = a.id;
  select job_code into v_job from ops.visits where id = a.visit_id;
  perform ento.notify(a.assigned_to, 'job_returned', 'Job ' || coalesce(v_job, '') || ' returned for verification',
                      ento.clean(p_note), '/jobs/' || a.visit_id, 'job', a.visit_id);
  perform ento.audit('job.returned', 'job_assignment', a.id,
                     jsonb_build_object('verification_status', 'rejected', 'round', a.round),
                     jsonb_build_object('verification_status', 'pending', 'round', a.round + 1, 'note', ento.clean(p_note)));
end;
$$;

-- Creates the operations visit for an approved request (internal).
-- Revisit: like an admin complaint decision in ops — a linked ops complaint + a revisit visit.
--          With a PCO it is scheduled; without one it waits (red) for the site's manager to pick the PCO.
-- Inspection: an inspection visit at the site (the site's manager attends; the PCO, if given, joins).
create function ento.create_request_visit(r ento.activity_requests, p_date date, p_time text, p_pco uuid)
returns uuid
language plpgsql security definer set search_path = ento, ops, public
as $$
declare v_complaint uuid; v_visit uuid;
begin
  if not exists (select 1 from ops.sites where id = r.site_id and manager_id is not null) then
    raise exception 'This site has no operations manager. Pick one under Sites first.' using errcode = '22023';
  end if;
  if p_date is null or p_date < ento.today() then raise exception 'Pick today or a later day' using errcode = '22023'; end if;
  perform ops.check_time(p_time);
  perform ops.check_team(p_pco, '{}', false);

  if r.type = 'revisit' then
    insert into ops.complaints (site_id, description, severity, lodged_by, lodged_by_name, status, decision,
                                decision_note, decided_by_name, decided_at)
    values (r.site_id, 'Entomologist revisit request ' || r.code || ': ' || r.reason || ' — ' || r.description,
            case r.priority when 'low' then 'Low' when 'medium' then 'Medium' else 'High' end,
            r.created_by, r.created_by_name, 'in_progress', 'revisit', r.decision_note, ento.me_name(), now())
    returning id into v_complaint;
    insert into ops.visits (kind, site_id, complaint_id, source, status, visit_date, visit_time, pco_id, note, created_by_name)
    values ('revisit', r.site_id, v_complaint, 'admin', case when p_pco is null then 'needs_pco' else 'scheduled' end,
            p_date, p_time, p_pco, r.code || ': ' || r.reason, ento.me_name())
    returning id into v_visit;
  else
    insert into ops.visits (kind, site_id, source, status, visit_date, visit_time, crew_ids, note, created_by_name)
    values ('inspection', r.site_id, 'admin', 'scheduled', p_date, p_time,
            case when p_pco is null then '{}'::uuid[] else array[p_pco] end,
            r.code || ': ' || r.purpose, ento.me_name())
    returning id into v_visit;
  end if;
  return v_visit;
end;
$$;

-- Admin approves or rejects a request. Approving with a date also schedules it.
create function ento.admin_decide_request(p_id uuid, p_decision text, p_note text,
                                          p_date date default null, p_time text default null, p_pco_id uuid default null)
returns void
language plpgsql security definer set search_path = ento, ops, public
as $$
declare r ento.activity_requests%rowtype;
begin
  perform ento.require(array['admin'], 'approve or reject requests');
  select * into r from ento.activity_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then raise exception 'This request was already decided' using errcode = '22023'; end if;
  if coalesce(p_decision, '') not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and ento.clean(p_note) is null then
    raise exception 'Write why it is rejected' using errcode = '22023';
  end if;
  update ento.activity_requests
     set status = p_decision::ento.request_status, decision_note = ento.clean(p_note),
         decided_by = auth.uid(), decided_by_name = ento.me_name(), decided_at = now(), assigned_to = auth.uid()
   where id = p_id;
  perform ento.audit('request.' || p_decision, 'activity_request', p_id,
                     jsonb_build_object('status', r.status), jsonb_build_object('status', p_decision, 'note', ento.clean(p_note)));
  if p_decision = 'approved' and p_date is not null then
    perform ento.admin_schedule_request(p_id, p_date, p_time, p_pco_id);
  end if;
end;
$$;

-- Admin sets the day, time and PCO of an approved request → the job appears in Operations.
create function ento.admin_schedule_request(p_id uuid, p_date date, p_time text, p_pco_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ento, ops, public
as $$
declare r ento.activity_requests%rowtype; v_visit uuid;
begin
  perform ento.require(array['admin'], 'schedule requests');
  select * into r from ento.activity_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'approved' then raise exception 'Approve the request first' using errcode = '22023'; end if;
  v_visit := ento.create_request_visit(r, p_date, p_time, p_pco_id);
  update ento.activity_requests
     set status = 'scheduled', scheduled_date = p_date, scheduled_time = p_time, assigned_pco = p_pco_id,
         scheduled_visit_id = v_visit
   where id = p_id;
  perform ento.audit('request.scheduled', 'activity_request', p_id, jsonb_build_object('status', 'approved'),
                     jsonb_build_object('status', 'scheduled', 'date', p_date, 'time', p_time, 'pco', p_pco_id, 'visit_id', v_visit));
  return v_visit;
end;
$$;

-- Admin / site manager moves a complaint along and / or replies.
-- Order: submitted → under_review → assigned → in_progress → resolved → closed (resolved may reopen to in_progress).
create function ento.admin_update_complaint(p_id uuid, p_status text, p_message text, p_assigned_to uuid default null)
returns void
language plpgsql security definer set search_path = ento, public
as $$
declare
  c     ento.complaints%rowtype;
  v_new ento.complaint_status;
  v_ord text[] := array['submitted', 'under_review', 'assigned', 'in_progress', 'resolved', 'closed'];
begin
  select * into c from ento.complaints where id = p_id for update;
  if not found then raise exception 'Complaint not found' using errcode = 'P0002'; end if;
  if not ento.can_manage_site(c.site_id) then
    raise exception 'Only admin or this site''s operations manager can update this complaint' using errcode = '42501';
  end if;
  if p_status is not null and p_status <> c.status::text then
    if not (p_status = any (v_ord)) then raise exception 'Unknown status' using errcode = '22023'; end if;
    v_new := p_status::ento.complaint_status;
    if not (array_position(v_ord, p_status) > array_position(v_ord, c.status::text)
            or (c.status = 'resolved' and v_new = 'in_progress')) then
      raise exception 'Cannot move a % complaint back to %', c.status, p_status using errcode = '22023';
    end if;
    if v_new = 'assigned' and coalesce(p_assigned_to, c.assigned_to) is null then
      raise exception 'Pick who handles it' using errcode = '22023';
    end if;
    update ento.complaints
       set status = v_new,
           assigned_to = coalesce(p_assigned_to, assigned_to),
           resolved_at = case when v_new = 'resolved' then now() when v_new = 'in_progress' then null else resolved_at end,
           closed_at   = case when v_new = 'closed' then now() else closed_at end
     where id = p_id;
    insert into ento.complaint_updates (complaint_id, kind, from_status, to_status, message, created_by, author_name, author_role)
    values (p_id, 'status', c.status, v_new, ento.clean(p_message), auth.uid(), ento.me_name(), public.my_role());
  else
    if ento.clean(p_message) is null then raise exception 'Write a response' using errcode = '22023'; end if;
    if p_assigned_to is not null then update ento.complaints set assigned_to = p_assigned_to where id = p_id; end if;
    insert into ento.complaint_updates (complaint_id, kind, message, created_by, author_name, author_role)
    values (p_id, 'response', ento.clean(p_message), auth.uid(), ento.me_name(), public.my_role());
  end if;
  perform ento.audit('complaint.update', 'complaint', p_id, jsonb_build_object('status', c.status),
                     jsonb_build_object('status', coalesce(p_status, c.status::text), 'message', ento.clean(p_message)));
end;
$$;

-- Admin creates (p_id null) or edits a meeting and its attendees.
create function ento.admin_save_meeting(
  p_id           uuid,
  p_title        text,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_location     text,
  p_online_link  text,
  p_agenda       text,
  p_attendee_ids uuid[]
)
returns uuid
language plpgsql security definer set search_path = ento, public
as $$
declare m ento.meetings%rowtype; v_id uuid := p_id; v_ids uuid[];
begin
  perform ento.require(array['admin'], 'schedule meetings');
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_attendee_ids, '{}')) x where x is not null;
  if v_ids is null then raise exception 'Invite at least one person' using errcode = '22023'; end if;
  if (select count(*) from public.profiles where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Some invitees are not staff' using errcode = '22023';
  end if;
  if ento.clean(p_title) is null then raise exception 'Add a title' using errcode = '22023'; end if;
  if p_starts_at is null then raise exception 'Pick the date and time' using errcode = '22023'; end if;

  if v_id is null then
    insert into ento.meetings (title, starts_at, ends_at, location, online_link, agenda, created_by, scheduled_by_name)
    values (ento.clean(p_title), p_starts_at, p_ends_at, ento.clean(p_location), ento.clean(p_online_link),
            ento.clean(p_agenda), auth.uid(), ento.me_name())
    returning id into v_id;
    perform ento.audit('meeting.created', 'meeting', v_id, null, jsonb_build_object('title', p_title, 'starts_at', p_starts_at));
  else
    select * into m from ento.meetings where id = v_id for update;
    if not found then raise exception 'Meeting not found' using errcode = 'P0002'; end if;
    if m.status = 'cancelled' then raise exception 'This meeting was cancelled' using errcode = '22023'; end if;
    update ento.meetings
       set title = ento.clean(p_title), starts_at = p_starts_at, ends_at = p_ends_at, location = ento.clean(p_location),
           online_link = ento.clean(p_online_link), agenda = ento.clean(p_agenda),
           status = case when p_starts_at is distinct from m.starts_at then 'rescheduled' else status end
     where id = v_id;
    delete from ento.meeting_attendance where meeting_id = v_id and not (assigned_to = any (v_ids));
    perform ento.audit('meeting.updated', 'meeting', v_id, to_jsonb(m),
                       jsonb_build_object('title', p_title, 'starts_at', p_starts_at, 'location', p_location));
  end if;

  insert into ento.meeting_attendance (meeting_id, assigned_to, created_by)
  select v_id, x, auth.uid() from unnest(v_ids) x
  on conflict (meeting_id, assigned_to) do nothing;
  return v_id;
end;
$$;

create function ento.admin_cancel_meeting(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ento, public
as $$
declare m ento.meetings%rowtype;
begin
  perform ento.require(array['admin'], 'cancel meetings');
  select * into m from ento.meetings where id = p_id for update;
  if not found then raise exception 'Meeting not found' using errcode = 'P0002'; end if;
  if m.status = 'cancelled' then raise exception 'Already cancelled' using errcode = '22023'; end if;
  if ento.clean(p_reason) is null then raise exception 'Write why it is cancelled' using errcode = '22023'; end if;
  update ento.meetings set status = 'cancelled', cancel_reason = ento.clean(p_reason) where id = p_id;
  perform ento.audit('meeting.cancelled', 'meeting', p_id, jsonb_build_object('status', m.status),
                     jsonb_build_object('status', 'cancelled', 'reason', ento.clean(p_reason)));
end;
$$;

-------------------------------------------------------------------------------
-- 8. Who may run which function
-------------------------------------------------------------------------------
revoke all on all functions in schema ento from public, anon;
grant execute on function
  ento.decide_job(uuid, text, text, text, jsonb, text, jsonb),
  ento.submit_request(text, uuid, uuid, text, text, text, text, date, jsonb),
  ento.cancel_request(uuid, text),
  ento.lodge_complaint(uuid, uuid, text, text, text, jsonb),
  ento.comment_complaint(uuid, text),
  ento.respond_meeting(uuid, text, text, text),
  ento.mark_notifications_read(uuid[]),
  ento.admin_set_site_access(uuid, uuid, boolean, boolean),
  ento.admin_assign_verifier(uuid, uuid),
  ento.admin_return_for_verification(uuid, text),
  ento.admin_decide_request(uuid, text, text, date, text, uuid),
  ento.admin_schedule_request(uuid, date, text, uuid),
  ento.admin_update_complaint(uuid, text, text, uuid),
  ento.admin_save_meeting(uuid, text, timestamptz, timestamptz, text, text, text, uuid[]),
  ento.admin_cancel_meeting(uuid, text),
  -- used inside row-security policies
  ento.can_see_site(uuid), ento.can_manage_site(uuid), ento.is_entomologist(), ento.today()
to authenticated;

-------------------------------------------------------------------------------
-- 9. Live updates (Supabase Realtime respects the policies above)
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notifications', 'job_assignments', 'activity_requests', 'complaints',
                           'complaint_updates', 'meetings', 'meeting_attendance'] loop
    begin
      execute format('alter publication supabase_realtime add table ento.%I', t);
    exception
      when undefined_object then raise notice 'Realtime publication not found; live updates are off.'; exit;
      when duplicate_object then null;
    end;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
