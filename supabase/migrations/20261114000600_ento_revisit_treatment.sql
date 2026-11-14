-- =============================================================================
-- IKPM — ENTOMOLOGIST PORTAL: a revisit repeats the job's treatment   migration 6
-- =============================================================================
-- A revisit an entomologist sends (or an approved inspection) becomes an Operations
-- visit. For a revisit that visit is now another treatment of the same job:
--   * same treatments as the original job;
--   * same PCO as the original job when that PCO is still active (the visit is then
--     scheduled straight away; the site manager can still change the team).
--     Otherwise it waits (red, "Needs PCO") for the site manager to pick one;
--   * a note that says it is an entomologist revisit, of which job, and why.
--
-- Run (SQL Editor) after migrations 1–5. Safe to run again.
-- =============================================================================

begin;

create or replace function ento.create_request_visit(r ento.activity_requests, p_date date, p_time text, p_pco uuid)
returns uuid
language plpgsql security definer set search_path = ento, ops, public
as $$
declare
  v_complaint uuid;
  v_visit     uuid;
  j           ops.visits%rowtype;
  v_pco       uuid := p_pco;
  v_note      text;
begin
  if not exists (select 1 from ops.sites where id = r.site_id and manager_id is not null) then
    raise exception 'This site has no operations manager. Pick one under Sites first.' using errcode = '22023';
  end if;
  if p_date is null or p_date < ento.today() then raise exception 'Pick today or a later day' using errcode = '22023'; end if;
  perform ops.check_time(p_time);

  if r.type = 'revisit' then
    select * into j from ops.visits where id = r.visit_id;
    -- Same PCO as the job being revisited, if still in the active field team.
    if v_pco is null and j.pco_id is not null and exists (select 1 from ops.staff where id = j.pco_id and active) then
      v_pco := j.pco_id;
    end if;
    perform ops.check_team(v_pco, '{}', false);
    v_note := 'Entomologist revisit ' || r.code || coalesce(' of ' || j.job_code, '') || ' (by ' || r.created_by_name || '): '
              || r.reason || coalesce(' — ' || r.description, '');

    insert into ops.complaints (site_id, description, severity, lodged_by, lodged_by_name, status, decision,
                                decision_note, decided_by_name, decided_at)
    values (r.site_id, v_note,
            case r.priority when 'low' then 'Low' when 'medium' then 'Medium' else 'High' end,
            r.created_by, r.created_by_name, 'in_progress', 'revisit', r.decision_note, ento.me_name(), now())
    returning id into v_complaint;

    insert into ops.visits (kind, site_id, complaint_id, source, status, visit_date, visit_time, pco_id, treatments, note, created_by_name)
    values ('revisit', r.site_id, v_complaint, 'admin', case when v_pco is null then 'needs_pco' else 'scheduled' end,
            p_date, p_time, v_pco, coalesce(j.treatments, '{}'), v_note, ento.me_name())
    returning id into v_visit;
  else
    perform ops.check_team(v_pco, '{}', false);
    insert into ops.visits (kind, site_id, source, status, visit_date, visit_time, crew_ids, note, created_by_name)
    values ('inspection', r.site_id, 'admin', 'scheduled', p_date, p_time,
            case when v_pco is null then '{}'::uuid[] else array[v_pco] end,
            'Entomologist inspection ' || r.code || ' (by ' || r.created_by_name || '): ' || r.purpose, ento.me_name())
    returning id into v_visit;
  end if;
  return v_visit;
end;
$$;

revoke all on function ento.create_request_visit(ento.activity_requests, date, text, uuid) from public, anon, authenticated;

-- The request keeps the PCO the visit got.
create or replace function ento.tg_request_pco_from_visit()
returns trigger language plpgsql security definer set search_path = ento, ops, public
as $$
begin
  if new.scheduled_visit_id is not null and new.assigned_pco is null then
    select pco_id into new.assigned_pco from ops.visits where id = new.scheduled_visit_id;
  end if;
  return new;
end;
$$;
drop trigger if exists activity_requests_pco on ento.activity_requests;
create trigger activity_requests_pco before update of scheduled_visit_id on ento.activity_requests
  for each row execute function ento.tg_request_pco_from_visit();
revoke all on function ento.tg_request_pco_from_visit() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
