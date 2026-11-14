-- =============================================================================
-- IKPM — ENTOMOLOGIST PORTAL ↔ OPERATIONS bridge                 migration 2 of 2
-- =============================================================================
-- Links schema "ento" to schema "ops". Safe to run again at any time.
--
-- !! Re-running ikpm-admin/supabase/ops.sql drops schema ops CASCADE, which also
--    removes everything in this file (foreign keys, policies, triggers, views,
--    the ops-files read policy). Run this file again right after ops.sql.
--
-- Adds, without changing any existing ops table, function or policy:
--   1. Foreign keys from ento.* to ops.clients / sites / visits / staff
--   2. Read-only row security on ops tables for entomologists: only their authorized
--      sites, the service jobs and inspections there, and the PCOs on those jobs.
--      No access to proposals, leads, finance, payroll or other staff.
--   3. Triggers on ops:
--        service report filed  → ento.job_assignments row, verification_status 'pending'
--                                (this is how a completed job reaches the entomologist)
--        service report changed → the old version is kept in ento.audit_log
--        request visit moved / done → the request's schedule / status follows
--   4. Views the portal reads (security_invoker: the caller's row security applies)
--   5. Storage: private bucket "ento-files" and entomologist read access to job photos
--      in "ops-files"
-- =============================================================================

begin;

do $$
begin
  if to_regnamespace('ento') is null then
    raise exception 'Run 20261114000100_ento_schema.sql first.';
  end if;
  if to_regclass('ops.visits') is null then
    raise exception 'Schema "ops" missing. Run ikpm-admin/supabase/ops.sql first.';
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 1. Foreign keys into ops
-------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      ('site_access',       'site_access_site_fk',           'site_id',            'ops.sites',   'cascade'),
      ('job_assignments',   'job_assignments_visit_fk',      'visit_id',           'ops.visits',  'restrict'),
      ('job_assignments',   'job_assignments_site_fk',       'site_id',            'ops.sites',   'restrict'),
      ('job_verifications', 'job_verifications_visit_fk',    'visit_id',           'ops.visits',  'restrict'),
      ('complaints',        'complaints_client_fk',          'client_id',          'ops.clients', 'restrict'),
      ('complaints',        'complaints_site_fk',            'site_id',            'ops.sites',   'restrict'),
      ('complaints',        'complaints_visit_fk',           'visit_id',           'ops.visits',  'set null'),
      ('activity_requests', 'activity_requests_client_fk',   'client_id',          'ops.clients', 'restrict'),
      ('activity_requests', 'activity_requests_site_fk',     'site_id',            'ops.sites',   'restrict'),
      ('activity_requests', 'activity_requests_visit_fk',    'visit_id',           'ops.visits',  'restrict'),
      ('activity_requests', 'activity_requests_pco_fk',      'assigned_pco',       'ops.staff',   'set null'),
      ('activity_requests', 'activity_requests_sched_fk',    'scheduled_visit_id', 'ops.visits',  'set null')
    ) as t (tbl, name, col, ref, on_delete)
  loop
    if not exists (select 1 from pg_constraint where conname = r.name and conrelid = ('ento.' || r.tbl)::regclass) then
      execute format('alter table ento.%I add constraint %I foreign key (%I) references %s (id) on delete %s not valid',
                     r.tbl, r.name, r.col, r.ref, r.on_delete);
      begin
        execute format('alter table ento.%I validate constraint %I', r.tbl, r.name);
      exception when foreign_key_violation then
        raise notice '% has rows pointing at operations data that no longer exists; left NOT VALID', r.name;
      end;
    end if;
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- 2. Entomologist read access on ops (added next to the existing ops policies)
--    ops.clients needs nothing: its policy already shows clients of visible sites.
--    ops.service_reports / inspection_reports / visit_history follow their visit.
-------------------------------------------------------------------------------
drop policy if exists "Entomologist: authorized sites" on ops.sites;
create policy "Entomologist: authorized sites" on ops.sites
  for select to authenticated
  using (ento.is_entomologist() and ento.can_see_site(id));

drop policy if exists "Entomologist: jobs and inspections at authorized sites" on ops.visits;
create policy "Entomologist: jobs and inspections at authorized sites" on ops.visits
  for select to authenticated
  using (ento.is_entomologist() and site_id is not null
         and kind in ('monthly', 'contract', 'revisit', 'inspection')
         and ento.can_see_site(site_id));

drop policy if exists "Entomologist: PCOs on visible jobs" on ops.staff;
create policy "Entomologist: PCOs on visible jobs" on ops.staff
  for select to authenticated
  using (ento.is_entomologist()
         and exists (select 1 from ops.visits v where v.pco_id = staff.id or staff.id = any (v.crew_ids)));

drop policy if exists "Entomologist: complaints at authorized sites" on ops.complaints;
create policy "Entomologist: complaints at authorized sites" on ops.complaints
  for select to authenticated
  using (ento.is_entomologist() and ento.can_see_site(site_id));

drop policy if exists "Entomologist: findings at authorized sites" on ops.site_issues;
create policy "Entomologist: findings at authorized sites" on ops.site_issues
  for select to authenticated
  using (ento.is_entomologist() and ento.can_see_site(site_id));

-------------------------------------------------------------------------------
-- 3. Triggers on ops
-------------------------------------------------------------------------------
-- A filed service report = a completed job → queue it as pending verification.
-- If the site has a primary entomologist they are named on it; otherwise all entomologists are told.
create or replace function ento.tg_service_report_completed()
returns trigger language plpgsql security definer set search_path = ento, ops, public
as $$
declare v_site uuid; v_ento uuid; v_job text; v_site_name text;
begin
  select v.site_id, v.job_code, s.name into v_site, v_job, v_site_name
    from ops.visits v join ops.sites s on s.id = v.site_id
   where v.id = new.visit_id;
  if v_site is null then return new; end if;

  select assigned_to into v_ento
    from ento.site_access
   where site_id = v_site and active
   order by is_primary desc, created_at
   limit 1;

  insert into ento.job_assignments (visit_id, site_id, assigned_to, completed_at, assigned_at, created_by, created_by_name)
  values (new.visit_id, v_site, v_ento, new.submitted_at, case when v_ento is not null then now() end,
          auth.uid(), coalesce(new.submitted_by_name, 'System'))
  on conflict (visit_id) do nothing;

  -- No primary entomologist for the site: every entomologist can verify it, so tell them all.
  if v_ento is null then
    insert into ento.notifications (assigned_to, kind, title, body, link, entity_type, entity_id, created_by)
    select p.id, 'job_assigned', 'Job ready for verification',
           coalesce(v_job, 'A job') || ' · ' || v_site_name || ' was completed and needs verification.',
           '/jobs/' || new.visit_id, 'job', new.visit_id, auth.uid()
      from public.profiles p where p.role = 'entomologist';
  end if;
  return new;
end;
$$;

drop trigger if exists ento_job_completed on ops.service_reports;
create trigger ento_job_completed after insert on ops.service_reports
  for each row execute function ento.tg_service_report_completed();

-- Historical PCO reports are never silently overwritten: every change keeps the old version.
create or replace function ento.tg_service_report_history()
returns trigger language plpgsql security definer set search_path = ento, public
as $$
begin
  insert into ento.audit_log (action, entity_type, entity_id, before, after, actor_name, actor_role, created_by)
  values ('report.' || lower(tg_op), 'service_report', old.visit_id, to_jsonb(old),
          case when tg_op = 'UPDATE' then to_jsonb(new) end,
          coalesce(ento.me_name(), 'System'), public.my_role(), auth.uid());
  return null;
end;
$$;

drop trigger if exists ento_report_history on ops.service_reports;
create trigger ento_report_history after update or delete on ops.service_reports
  for each row execute function ento.tg_service_report_history();

-- The operations visit made for a request: keep the request's day / PCO in step, and
-- mark the request completed when the visit is done.
create or replace function ento.tg_request_visit_sync()
returns trigger language plpgsql security definer set search_path = ento, ops, public
as $$
begin
  update ento.activity_requests
     set scheduled_date = new.visit_date,
         scheduled_time = new.visit_time,
         assigned_pco   = coalesce(new.pco_id, assigned_pco),
         status         = case when new.status = 'done' and status = 'scheduled' then 'completed' else status end
   where scheduled_visit_id = new.id
     and (scheduled_date, scheduled_time, assigned_pco, status)
         is distinct from (new.visit_date, new.visit_time, coalesce(new.pco_id, assigned_pco),
                           case when new.status = 'done' and status = 'scheduled' then 'completed'::ento.request_status else status end);
  return new;
end;
$$;

drop trigger if exists ento_request_visit_sync on ops.visits;
create trigger ento_request_visit_sync after update of status, visit_date, visit_time, pco_id on ops.visits
  for each row execute function ento.tg_request_visit_sync();

revoke all on function ento.tg_service_report_completed(), ento.tg_service_report_history(), ento.tg_request_visit_sync()
  from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 4. Views read by the portal (security_invoker = the caller's row security applies)
-------------------------------------------------------------------------------
drop view if exists ento.v_sites, ento.v_jobs, ento.v_inspections, ento.v_requests, ento.v_complaints, ento.v_my_meetings;

-- Sites the caller can see, with their client.
create view ento.v_sites with (security_invoker = true) as
select s.id as site_id, s.name as site_name, s.city, s.address, s.status as site_status,
       s.client_id, c.name as client_name, c.code as client_code,
       coalesce(a.is_primary, false) as is_primary
  from ops.sites s
  join ops.clients c on c.id = s.client_id
  left join ento.site_access a on a.site_id = s.id and a.assigned_to = auth.uid() and a.active;

-- Service jobs with their PCO report and verification state (one row per job).
create view ento.v_jobs with (security_invoker = true) as
select v.id as visit_id, v.job_code, v.kind, v.status as visit_status, v.visit_date, v.visit_time,
       v.treatments, v.note as visit_note, v.complaint_id, v.started_at, v.before_photos,
       v.site_id, s.name as site_name, s.city as site_city, s.address as site_address,
       s.client_id, c.name as client_name,
       v.pco_id, p.full_name as pco_name, p.phone as pco_phone,
       (select array_agg(x.full_name order by x.full_name) from ops.staff x where x.id = any (v.crew_ids)) as crew_names,
       r.outcome, r.items, r.extras, r.findings, r.notes as report_notes, r.found_photos, r.after_photos,
       r.challan_no, r.challan_date, r.challan_file, r.submitted_by_name, r.submitted_at,
       (select array_agg(x.full_name order by x.full_name) from ops.staff x where x.id = any (r.team_ids)) as team_names,
       a.id as assignment_id, a.assigned_to, a.verification_status, a.completed_at, a.round, a.return_note,
       a.decided_at,
       lv.decision as last_decision, lv.remarks as last_remarks, lv.reason as last_reason,
       lv.verifier_name as last_verifier_name, lv.created_at as last_decided_at
  from ops.visits v
  join ops.sites s on s.id = v.site_id
  join ops.clients c on c.id = s.client_id
  left join ops.staff p on p.id = v.pco_id
  left join ops.service_reports r on r.visit_id = v.id
  left join ento.job_assignments a on a.visit_id = v.id
  left join lateral (
    select jv.decision, jv.remarks, jv.reason, jv.verifier_name, jv.created_at
      from ento.job_verifications jv
     where jv.assignment_id = a.id
     order by jv.created_at desc
     limit 1
  ) lv on true
 where v.kind in ('monthly', 'contract', 'revisit');

-- Site inspections (ops inspection visits at a client site and their reports).
create view ento.v_inspections with (security_invoker = true) as
select v.id as visit_id, v.site_id, s.name as site_name, s.client_id, c.name as client_name,
       v.visit_date, v.visit_time, v.status as visit_status, v.note,
       ir.activity, ir.advice, ir.areas, ir.notes as report_notes, ir.written_by_name, ir.written_at
  from ops.visits v
  join ops.sites s on s.id = v.site_id
  join ops.clients c on c.id = s.client_id
  left join ops.inspection_reports ir on ir.visit_id = v.id
 where v.kind = 'inspection';

-- Requests with names and the progress of the visit made for them.
create view ento.v_requests with (security_invoker = true) as
select r.*, s.name as site_name, c.name as client_name,
       pv.job_code as prev_job_code, pv.visit_date as prev_visit_date,
       sv.status as scheduled_visit_status, sv.job_code as scheduled_job_code,
       st.full_name as pco_name
  from ento.activity_requests r
  join ops.sites s on s.id = r.site_id
  join ops.clients c on c.id = r.client_id
  left join ops.visits pv on pv.id = r.visit_id
  left join ops.visits sv on sv.id = r.scheduled_visit_id
  left join ops.staff st on st.id = coalesce(sv.pco_id, r.assigned_pco);

create view ento.v_complaints with (security_invoker = true) as
select k.*, s.name as site_name, c.name as client_name, v.job_code, v.visit_date as job_date
  from ento.complaints k
  join ops.sites s on s.id = k.site_id
  join ops.clients c on c.id = k.client_id
  left join ops.visits v on v.id = k.visit_id;

-- The caller's meetings with their own attendance.
create view ento.v_my_meetings with (security_invoker = true) as
select m.*, a.id as attendance_id, a.rsvp, a.rsvp_at, a.attendance, a.attendance_at, a.notes as my_notes
  from ento.meetings m
  join ento.meeting_attendance a on a.meeting_id = m.id and a.assigned_to = auth.uid();

grant select on ento.v_sites, ento.v_jobs, ento.v_inspections, ento.v_requests, ento.v_complaints, ento.v_my_meetings
  to authenticated;

-------------------------------------------------------------------------------
-- 5. Storage
--    ento-files/<user id>/…  photos and documents uploaded from this portal (private;
--    read through signed URLs). A file is readable by its uploader, and by anyone
--    who can see the record it is attached to.
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ento-files', 'ento-files', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Ento files: upload to own folder" on storage.objects;
create policy "Ento files: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ento-files'
              and (storage.foldername(name))[1] = auth.uid()::text
              and coalesce(public.my_role(), '') in ('entomologist', 'admin', 'operations'));

drop policy if exists "Ento files: read own or attached to a visible record" on storage.objects;
create policy "Ento files: read own or attached to a visible record" on storage.objects
  for select to authenticated
  using (bucket_id = 'ento-files'
         and ((storage.foldername(name))[1] = auth.uid()::text
              or exists (select 1 from ento.attachments a where a.path = objects.name)));

-- Uploads that never got attached (a form that failed) can be removed by their owner.
drop policy if exists "Ento files: remove own unattached upload" on storage.objects;
create policy "Ento files: remove own unattached upload" on storage.objects
  for delete to authenticated
  using (bucket_id = 'ento-files'
         and (storage.foldername(name))[1] = auth.uid()::text
         and not exists (select 1 from ento.attachments a where a.path = objects.name));

-- Job photos / signed challans in ops-files are stored under <visit id>/…
drop policy if exists "Ops files: entomologist reads authorized jobs" on storage.objects;
create policy "Ops files: entomologist reads authorized jobs" on storage.objects
  for select to authenticated
  using (bucket_id = 'ops-files'
         and ento.is_entomologist()
         and exists (select 1 from ops.visits v where v.id::text = (storage.foldername(objects.name))[1]));

commit;

notify pgrst, 'reload schema';
