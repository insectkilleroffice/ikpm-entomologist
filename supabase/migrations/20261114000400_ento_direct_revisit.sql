-- =============================================================================
-- IKPM — ENTOMOLOGIST PORTAL: revisits go straight to Operations   migration 4
-- =============================================================================
-- An entomologist's revisit no longer waits for admin approval. send_revisit():
--   * records the revisit request (status 'scheduled', linked to the job and site);
--   * creates the Operations revisit visit on the chosen date and time (the site's
--     operations manager picks the PCO and can move it, as for any revisit);
--   * if the job was waiting for verification, records "revisit requested" on it;
--   * tells admin and the site's operations manager.
-- Inspection requests still go through admin approval (submit_request).
--
-- Run (SQL Editor) after migrations 1–3. Safe to run again.
-- =============================================================================

begin;

drop function if exists ento.send_revisit(uuid, text, text, date);   -- earlier version without a time

create or replace function ento.send_revisit(p_visit_id uuid, p_reason text, p_description text, p_date date, p_time text)
returns uuid
language plpgsql security definer set search_path = ento, ops, public
as $$
declare
  v       ops.visits%rowtype;
  r       ento.activity_requests%rowtype;
  a       ento.job_assignments%rowtype;
  v_visit uuid;
  v_site  text;
begin
  perform ento.require(array['entomologist'], 'send revisits');
  select * into v from ops.visits where id = p_visit_id;
  if not found or v.site_id is null or v.kind not in ('monthly', 'contract', 'revisit') then
    raise exception 'Pick the job to revisit' using errcode = '22023';
  end if;
  if ento.clean(p_reason) is null then raise exception 'Write the reason for the revisit' using errcode = '22023'; end if;
  if length(coalesce(ento.clean(p_description), '')) < 10 then
    raise exception 'Describe the problem (at least 10 characters)' using errcode = '22023';
  end if;
  if p_date is null or p_date < ento.today() then
    raise exception 'Pick today or a later date' using errcode = '22023';
  end if;
  select name into v_site from ops.sites where id = v.site_id;

  insert into ento.activity_requests (type, client_id, site_id, visit_id, reason, description, priority,
                                      recommended_date, created_by, created_by_name)
  select 'revisit', s.client_id, v.site_id, v.id, ento.clean(p_reason), ento.clean(p_description), 'medium',
         p_date, auth.uid(), ento.me_name()
    from ops.sites s where s.id = v.site_id
  returning * into r;

  v_visit := ento.create_request_visit(r, p_date, p_time, null);   -- checks the time format

  update ento.activity_requests
     set status = 'scheduled', scheduled_date = p_date, scheduled_time = p_time, scheduled_visit_id = v_visit,
         decision_note = 'Sent directly to Operations', decided_by = auth.uid(), decided_by_name = ento.me_name(),
         decided_at = now()
   where id = r.id;

  select * into a from ento.job_assignments where visit_id = v.id and verification_status = 'pending' for update;
  if found then
    insert into ento.job_verifications (assignment_id, visit_id, round, decision, remarks, reason, created_by, verifier_name)
    values (a.id, a.visit_id, a.round, 'revisit_requested', 'Revisit ' || r.code, ento.clean(p_reason), auth.uid(), ento.me_name());
    update ento.job_assignments set verification_status = 'revisit_requested', decided_at = now() where id = a.id;
  end if;

  perform ento.audit('revisit.sent', 'activity_request', r.id, null,
                     jsonb_build_object('code', r.code, 'job', v.id, 'ops_visit', v_visit, 'date', p_date));
  perform ento.notify_staff(v.site_id, 'request_submitted', 'Revisit ' || r.code || ' sent by entomologist',
                            v_site || ' on ' || to_char(p_date, 'DD Mon') || ' ' || p_time || ': ' || ento.clean(p_reason), 'activity_request', r.id);
  return r.id;
end;
$$;

revoke all on function ento.send_revisit(uuid, text, text, date, text) from public, anon;
grant execute on function ento.send_revisit(uuid, text, text, date, text) to authenticated;

-- Do not notify people about status changes they made themselves.
create or replace function ento.tg_request_status_notify()
returns trigger language plpgsql security definer set search_path = ento, public
as $$
declare v_kind ento.notification_kind; v_title text; v_body text;
begin
  if new.status is not distinct from old.status or new.created_by = auth.uid() then return new; end if;
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

commit;

notify pgrst, 'reload schema';
