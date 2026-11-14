-- =============================================================================
-- IKPM — ENTOMOLOGIST PORTAL: complaint about a job's report        migration 5
-- =============================================================================
-- Adds the complaint category "report_quality" (unclear / blurry photos, incomplete
-- PCO report), used by the "Lodge complaint" button next to Verify. The complaint goes
-- to admin and the site's operations manager like any other; the job stays pending.
--
-- Run (SQL Editor) after migrations 1–4. Safe to run again.
-- =============================================================================

alter type ento.complaint_category add value if not exists 'report_quality';

begin;

create or replace function ento.lodge_complaint(
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
  if p_visit_id is not null and not exists (select 1 from ops.visits where id = p_visit_id and site_id = p_site_id) then
    raise exception 'That job is not at this site' using errcode = '22023';
  end if;
  if coalesce(p_category, '') not in ('poor_treatment_quality', 'pest_activity_present', 'client_dissatisfaction',
                                      'pco_performance', 'chemical_safety', 'site_hygiene', 'report_quality', 'other') then
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
                     jsonb_build_object('code', v_code, 'site_id', p_site_id, 'visit_id', p_visit_id,
                                        'priority', p_priority, 'category', p_category));
  perform ento.notify_staff(p_site_id, 'complaint_lodged', 'Complaint ' || v_code || ' (' || p_priority || ')',
                            v_site || ': ' || ento.clean(p_description), 'complaint', v_id);
  return v_id;
end;
$$;

commit;

notify pgrst, 'reload schema';
