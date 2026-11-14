-- =============================================================================
-- IKPM Entomologist — SAMPLE DATA for development / testing ONLY
-- =============================================================================
-- !! Do not run on the production project. Production data stays in Supabase as
--    entered by Admin / Operations. Remove everything this adds with
--    dev-sample-data-cleanup.sql.
--
-- Before running:
--   1. Create the entomologist login (Authentication → Users → Add user) and its profile:
--        insert into public.profiles (id, full_name, email, role)
--        select id, 'Dr. Sana Malik', email, 'entomologist' from auth.users where email = '<their email>';
--   2. Put that email in v_email below and change v_confirm to 'dev'.
--   An admin profile and an operations profile are used when present (meetings, approvals).
--
-- Every row created here has an id starting with 5eed, so the cleanup file removes
-- exactly these rows. Everything goes through the real database functions, so the
-- data looks exactly like what the portals produce (assignments, decisions, audit).
-- =============================================================================

-- Treatments for the n-th sample job (session-only helper in pg_temp).
create or replace function pg_temp.ento_seed_treatments(n int) returns text[] language sql immutable as $f$
  select case n % 4
    when 0 then array['Cockroach gel baiting', 'Crack & crevice spray']
    when 1 then array['Rodent bait stations', 'Glue boards']
    when 2 then array['Flying insect control', 'ULV fogging']
    else array['General pest spray', 'Drain treatment'] end
$f$;

do $$
declare
  v_email   text := 'entomologist@example.com';   -- ← the entomologist's login email
  v_confirm text := 'no';                         -- ← change to 'dev' to confirm this is NOT production

  v_ento  uuid;
  v_admin uuid;
  v_ops   uuid;
  t       date := (now() at time zone 'Asia/Karachi')::date;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  c1 uuid; c2 uuid; c3 uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
  v  uuid;
  a  uuid;
  r  uuid;
  k  uuid;
  m  uuid;
  i  int;
  site_ids uuid[];
  pcos uuid[];
  finds text[] := array[
    'Cockroach activity under the dishwashing sink',
    'Rodent droppings near the dry store entrance',
    'Gaps under the loading bay door',
    'Fly activity around the waste area',
    'Ants trailing along the pantry skirting'];
begin
  if v_confirm <> 'dev' then
    raise exception 'Sample data is for development only. Edit v_confirm to ''dev'' after checking this is not the production project.';
  end if;
  select id into v_ento from public.profiles where lower(email) = lower(v_email) and role = 'entomologist';
  if v_ento is null then
    raise exception 'No entomologist profile with email %. See step 1 at the top of this file.', v_email;
  end if;
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_ops from public.profiles where role = 'operations' order by created_at limit 1;
  if exists (select 1 from ops.clients where id::text like '5eed%') then
    raise exception 'Sample data is already loaded. Run dev-sample-data-cleanup.sql first to reload it.';
  end if;

  -- ids: 5eed + md5 of a name (stable and recognizable)
  -- PCOs
  insert into ops.staff (id, full_name, phone) values
    (('5eed' || substr(md5('pco1'), 5))::uuid, 'Imran Qureshi (sample)', '0300-1110001'),
    (('5eed' || substr(md5('pco2'), 5))::uuid, 'Kashif Mehmood (sample)', '0300-1110002'),
    (('5eed' || substr(md5('pco3'), 5))::uuid, 'Faisal Raza (sample)', '0300-1110003'),
    (('5eed' || substr(md5('pco4'), 5))::uuid, 'Usman Tariq (sample)', '0300-1110004');
  p1 := ('5eed' || substr(md5('pco1'), 5))::uuid; p2 := ('5eed' || substr(md5('pco2'), 5))::uuid;
  p3 := ('5eed' || substr(md5('pco3'), 5))::uuid; p4 := ('5eed' || substr(md5('pco4'), 5))::uuid;

  -- Clients and sites
  c1 := ('5eed' || substr(md5('c-alnoor'), 5))::uuid;
  c2 := ('5eed' || substr(md5('c-beacon'), 5))::uuid;
  c3 := ('5eed' || substr(md5('c-crescent'), 5))::uuid;
  insert into ops.clients (id, name, created_by_name) values
    (c1, 'Alnoor Foods (sample)', 'Sample data'),
    (c2, 'Beacon Hotels (sample)', 'Sample data'),
    (c3, 'Crescent Textiles (sample)', 'Sample data');

  s1 := ('5eed' || substr(md5('s-clifton'), 5))::uuid;
  s2 := ('5eed' || substr(md5('s-dha'), 5))::uuid;
  s3 := ('5eed' || substr(md5('s-mallroad'), 5))::uuid;
  s4 := ('5eed' || substr(md5('s-gulberg'), 5))::uuid;
  s5 := ('5eed' || substr(md5('s-site'), 5))::uuid;
  insert into ops.sites (id, client_id, name, city, address, visits_per_month, pco_id, manager_id, status) values
    (s1, c1, 'Clifton Kitchen', 'Karachi', 'Block 5, Clifton', 4, p1, v_ops, 'active'),
    (s2, c1, 'DHA Phase 6 Outlet', 'Karachi', 'Bukhari Commercial, DHA Phase 6', 2, p2, v_ops, 'active'),
    (s3, c2, 'Mall Road Hotel', 'Lahore', '87 Shahrah-e-Quaid-e-Azam', 4, p3, v_ops, 'active'),
    (s4, c2, 'Gulberg Hotel', 'Lahore', 'MM Alam Road, Gulberg III', 2, p3, v_ops, 'active'),
    (s5, c3, 'SITE Area Mill', 'Karachi', 'Plot F-12, SITE Area', 2, p4, v_ops, 'active');

  -- Authorize the entomologist (primary) for four sites; Gulberg stays unauthorized
  -- so the access rules can be seen working.
  insert into ento.site_access (site_id, assigned_to, is_primary, active, created_by)
  select x, v_ento, true, true, v_admin from unnest(array[s1, s2, s3, s5]) x;

  site_ids := array[s1, s2, s3, s5, s4];
  pcos := array[p1, p2, p3, p4, p3];

  -- Completed jobs over the last five weeks (each completion queues a verification)
  for i in 0..14 loop
    v := ('5eed' || substr(md5('job' || i), 5))::uuid;
    insert into ops.visits (id, kind, site_id, source, status, visit_date, visit_time, pco_id, treatments, note, created_by_name)
    values (v, case when i % 5 = 4 then 'contract' else 'monthly' end, site_ids[i % 5 + 1], 'ops', 'started',
            t - (35 - i * 2), (array['09:00', '10:00', '11:00', '14:00', '15:00'])[i % 5 + 1], pcos[i % 5 + 1],
            pg_temp.ento_seed_treatments(i), 'Routine service', 'Sample data');
    update ops.visits set started_at = (visit_date + visit_time::time) at time zone 'Asia/Karachi' where id = v;
    insert into ops.service_reports (visit_id, outcome, team_ids, items, findings, notes, challan_no, challan_date, challan_file, submitted_by_name, submitted_at)
    values (v, case when i % 7 = 3 then 'partial' else 'completed' end, array[pcos[i % 5 + 1]],
            jsonb_build_array(jsonb_build_object('name', 'Maxforce gel', 'qty', 10 + i, 'unit', 'g'),
                              jsonb_build_object('name', 'Cypermethrin 10% EC', 'qty', 200 + i * 10, 'unit', 'ml')),
            case when i % 3 = 0 then array[finds[i % 5 + 1]] else '{}' end,
            'All areas treated. Client representative signed the challan.',
            'SMP-' || lpad(i::text, 4, '0'), t - (35 - i * 2), 'sample/challan.pdf', 'Sample data',
            ((t - (35 - i * 2)) + time '17:00') at time zone 'Asia/Karachi');
    update ops.visits set status = 'done' where id = v;
  end loop;

  -- Decide the older jobs as the entomologist would (real functions, real audit trail)
  perform set_config('request.jwt.claim.sub', v_ento::text, true);
  for a, i in
    select ja.id, row_number() over (order by ja.completed_at)::int
      from ento.job_assignments ja where ja.visit_id::text like '5eed%' and ja.assigned_to = v_ento
     order by ja.completed_at
  loop
    exit when i > 7;
    if i in (3, 6) then
      perform ento.decide_job(a, 'rejected', null,
        'Signed challan is unreadable and the gel quantity does not match the site size. Please re-upload and confirm.');
    else
      perform ento.decide_job(a, 'verified', 'Treatment and materials match the contract.',
        null, '{"treatment":true,"chemicals":true,"photos":true,"report":true}', (array['none', 'low', 'medium'])[i % 3 + 1]);
    end if;
  end loop;

  -- Upcoming and today's scheduled jobs (calendar)
  for i in 0..9 loop
    insert into ops.visits (id, kind, site_id, source, status, visit_date, visit_time, pco_id, treatments, created_by_name)
    values (('5eed' || substr(md5('next' || i), 5))::uuid, 'monthly', site_ids[i % 4 + 1], 'ops', 'scheduled',
            t + (i * 2) - 2, (array['09:00', '11:00', '14:00'])[i % 3 + 1], pcos[i % 4 + 1], pg_temp.ento_seed_treatments(i), 'Sample data');
  end loop;

  -- A revisit request on a pending job, and an inspection request
  select visit_id into v from ento.job_assignments
   where visit_id::text like '5eed%' and assigned_to = v_ento and verification_status = 'pending' order by completed_at limit 1;
  r := ento.submit_request('revisit', (select site_id from ops.visits where id = v), v,
         'Cockroach activity persists after treatment', null,
         'Live German cockroaches seen under the dishwashing sink and inside the dry store shelving two days after the service.',
         'high', t + 2);
  k := ento.submit_request('inspection', s3, null, null, 'Quarterly rodent risk assessment',
         'Burrows observed along the boundary wall near the kitchen waste area; staff report gnaw marks on stored sacks.',
         'medium', t + 4);
  perform ento.lodge_complaint((select site_id from ops.visits where id = v), v, 'pco_performance',
          'PCO left before treating the store room and did not refill two bait stations.', 'high');
  perform ento.lodge_complaint(s5, null, 'site_hygiene',
          'Waste is stored openly next to the loading bay, attracting flies and rodents despite repeated advice.', 'medium');

  -- Admin side: approve + schedule the inspection, answer a complaint, schedule meetings
  if v_admin is not null then
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    if v_ops is not null then
      perform ento.admin_decide_request(k, 'approved', 'Approved. Please join the inspection.', t + 5, '11:00', p3);
    else
      perform ento.admin_decide_request(k, 'approved', 'Approved. Date to follow.');
    end if;
    perform ento.admin_update_complaint(
      (select id from ento.complaints where created_by = v_ento and visit_id = v limit 1),
      'under_review', 'Checking with the operations manager and the PCO.');

    m := ento.admin_save_meeting(null, 'Monthly verification review', ((t + 1) + time '15:00') at time zone 'Asia/Karachi',
           ((t + 1) + time '16:00') at time zone 'Asia/Karachi', 'Head office, Shahrah-e-Faisal', null,
           E'1. Rejected jobs this month\n2. Repeat cockroach complaints\n3. New sites', array[v_ento]);
    m := ento.admin_save_meeting(null, 'Client walk-through: Mall Road Hotel', ((t + 6) + time '10:30') at time zone 'Asia/Karachi',
           null, 'Mall Road Hotel, Lahore', null, 'Joint inspection with the client''s facilities manager.', array[v_ento]);
    m := ento.admin_save_meeting(null, 'Pesticide safety refresher', (t + time '17:00') at time zone 'Asia/Karachi',
           (t + time '17:45') at time zone 'Asia/Karachi', null, 'https://meet.google.com/sample-meeting', 'Safe handling of new rodenticide stock.', array[v_ento]);
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'Sample data loaded for %', v_email;
end;
$$;
