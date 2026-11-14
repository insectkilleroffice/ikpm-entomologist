-- =============================================================================
-- IKPM — ENTOMOLOGIST PORTAL: open access                        migration 3
-- =============================================================================
-- Entomologists work on ALL jobs — no site authorization or assignment needed:
--   * every entomologist sees all sites, service jobs and inspections;
--   * any entomologist can Verify / Reject / Request revisit on any pending job
--     (the decision row records who did it; a job is still decided only once per round);
--   * newly completed jobs notify all entomologists (see the bridge migration);
--   * completed jobs that existed before this migration are queued as pending.
-- ento.site_access is kept as optional: a "primary" entomologist for a site still gets
-- that site's completion notice addressed to them.
--
-- Run once (SQL Editor), after migrations 1 and 2. Then re-run
-- 20261114000200_ento_ops_bridge.sql (it carries the updated completion trigger).
-- =============================================================================

begin;

-- 1. Entomologists can see every site.
create or replace function ento.can_see_site(p_site_id uuid)
returns boolean language plpgsql stable security definer set search_path = ento, ops, public
as $$
begin
  case coalesce(public.my_role(), '')
    when 'admin' then return true;
    when 'entomologist' then return true;
    when 'operations' then
      return exists (select 1 from ops.sites s where s.id = p_site_id and s.manager_id = auth.uid());
    else return false;
  end case;
end;
$$;

-- 2. Any entomologist may decide any pending job.
create or replace function ento.decide_job(
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
  a        ento.job_assignments%rowtype;
  v_id     uuid;
  v_job    text;
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

-- 3. A revisit requested on any pending job counts as the decision on that job.
create or replace function ento.submit_request(
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

  if p_type = 'revisit' then
    select * into a from ento.job_assignments
     where visit_id = p_visit_id and verification_status = 'pending' for update;
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

-- 4. Admin may still name a specific entomologist for a job (optional).
create or replace function ento.admin_assign_verifier(p_visit_id uuid, p_entomologist_id uuid)
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
  if not exists (select 1 from public.profiles where id = p_entomologist_id and role = 'entomologist') then
    raise exception 'That person is not an entomologist' using errcode = '22023';
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

-- 5. Completed jobs from before the portal existed wait for verification too
--    (no notifications are sent for these).
insert into ento.job_assignments (visit_id, site_id, assigned_to, completed_at, created_by_name)
select r.visit_id, v.site_id, null, r.submitted_at, 'Existing completed job'
  from ops.service_reports r
  join ops.visits v on v.id = r.visit_id
 where v.site_id is not null
on conflict (visit_id) do nothing;

commit;

notify pgrst, 'reload schema';
