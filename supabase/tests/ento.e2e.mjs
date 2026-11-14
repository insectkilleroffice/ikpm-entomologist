// Database test for the entomologist portal: runs the real Admin / Operations schema
// files (../ikpm-admin/supabase) and this portal's migrations on real Postgres (PGlite,
// in-process), with minimal Supabase stubs (auth.uid, storage, roles), then plays out
// every workflow as admin, operations and two entomologists with row security on.
// Also loads and removes the sample data.            Run:  npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let db = new PGlite();

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra); } };

async function q(sql, params = []) { return (await db.query(sql, params)).rows; }
async function one(sql, params = []) { return (await q(sql, params))[0]; }
async function as(uid) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  if (uid) await db.exec('set role authenticated');
}
async function su() { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
async function throws(sql, params, re, name) {
  try { await db.query(sql, params); ok(false, name, '(no error raised)'); }
  catch (e) { ok(re.test(e.message), name, `(got: ${e.message})`); }
}

// ---------------------------------------------------------------- Supabase stubs
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
  grant usage on schema storage to authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  grant execute on function storage.foldername(text) to authenticated;
`);
try { await db.exec('create publication supabase_realtime'); } catch (e) { console.log('(no publication support in PGlite: ' + e.message + ')'); }

// ---------------------------------------------------------------- real schema files
const A = '00000000-0000-0000-0000-00000000000a', O = '00000000-0000-0000-0000-00000000000b',
      E = '00000000-0000-0000-0000-00000000000e', E2 = '00000000-0000-0000-0000-0000000000e2',
      O2 = '00000000-0000-0000-0000-0000000000b2';
await db.exec(`insert into auth.users values ('${A}','admin@x.pk'),('${O}','ops@x.pk'),('${E}','ento@x.pk'),('${E2}','ento2@x.pk'),('${O2}','ops2@x.pk')`);

for (const f of ['ikpm-admin/supabase/fresh-start.sql', 'ikpm-admin/supabase/ops.sql', 'ikpm-admin/supabase/patch-optional-items.sql']) {
  await db.exec(read(f).replace(/notify pgrst[^;]*;/g, ''));
  console.log('loaded', f);
}
await db.exec(`insert into public.profiles (id, full_name, email, role) values
  ('${A}','Ayesha Admin','admin@x.pk','admin'),('${O}','Omar Ops','ops@x.pk','operations'),('${O2}','Other Ops','ops2@x.pk','operations')`);

const M3 = 'ikpm-entomologist/supabase/migrations/20261114000300_ento_open_access.sql';
const M4 = 'ikpm-entomologist/supabase/migrations/20261114000400_ento_direct_revisit.sql';
const M5 = 'ikpm-entomologist/supabase/migrations/20261114000500_ento_job_complaint.sql';
const M6 = 'ikpm-entomologist/supabase/migrations/20261114000600_ento_revisit_treatment.sql';
for (const f of ['ikpm-entomologist/supabase/migrations/20261114000100_ento_schema.sql', 'ikpm-entomologist/supabase/migrations/20261114000200_ento_ops_bridge.sql', M3, M4, M5, M6]) {
  await db.exec(read(f).replace(/notify pgrst[^;]*;/g, ''));
  console.log('loaded', f);
}
// bridge is re-runnable
await db.exec(read('ikpm-entomologist/supabase/migrations/20261114000200_ento_ops_bridge.sql').replace(/notify pgrst[^;]*;/g, ''));
ok(true, 'bridge migration runs a second time without error');

await db.exec(`insert into public.profiles (id, full_name, email, role) values
  ('${E}','Dr. Sana Entomologist','ento@x.pk','entomologist'),('${E2}','Dr. Bilal Second','ento2@x.pk','entomologist')`);
ok(true, "profiles accept role 'entomologist'");

// ---------------------------------------------------------------- operations data (as Ops would have it)
const today = (await one(`select ops.today()::text d`)).d;
const P1 = (await one(`insert into ops.staff (full_name, phone) values ('Ali PCO','0300-1') returning id`)).id;
const P2 = (await one(`insert into ops.staff (full_name, phone) values ('Zain PCO','0300-2') returning id`)).id;
const C1 = (await one(`insert into ops.clients (name, created_by_name) values ('Alnoor Foods','Ayesha') returning id`)).id;
const C2 = (await one(`insert into ops.clients (name, created_by_name) values ('Beacon Hotels','Ayesha') returning id`)).id;
const S1 = (await one(`insert into ops.sites (client_id,name,city,visits_per_month,pco_id,manager_id,status) values ($1,'Clifton outlet','Karachi',2,$2,$3,'active') returning id`, [C1, P1, O])).id;
const S2 = (await one(`insert into ops.sites (client_id,name,city,visits_per_month,pco_id,manager_id,status) values ($1,'Mall Road','Lahore',2,$2,$3,'active') returning id`, [C2, P2, O])).id;
const mkVisit = async (site, pco, date, kind = 'monthly') =>
  (await one(`insert into ops.visits (kind,site_id,source,status,visit_date,visit_time,pco_id,treatments,created_by_name)
              values ($1,$2,'ops','scheduled',$3,'10:00',$4,'{Gel baiting}','Omar') returning id`, [kind, site, date, pco])).id;
const V1 = await mkVisit(S1, P1, today);
const V2 = await mkVisit(S1, P1, today);
const VS2 = await mkVisit(S2, P2, today);

const complete = async (visit, pco, ch) => {
  await as(O);
  await q(`select ops.start_visit($1, '{}')`, [visit]);
  await q(`select ops.submit_service_report($1,'completed',array[$2]::uuid[],'[{"name":"Gel","qty":5,"unit":"g"}]'::jsonb,'[]'::jsonb,
           array['Roaches in kitchen'],'Done',array[]::text[],array[]::text[],$3,ops.today(),$4)`, [visit, pco, ch, `${visit}/challan/c.jpg`]);
  await su();
};

console.log('\n1. Site authorization + completed job → pending verification');
await as(A);
await q(`select ento.admin_set_site_access($1,$2,true,true)`, [S1, E]);
await throws(`select ento.admin_set_site_access($1,$2,true,true)`, [S1, O], /not an entomologist/, 'only entomologists can be authorized');
await as(E);
await throws(`select ento.admin_set_site_access($1,$2,true,true)`, [S2, E], /Only admin/, 'entomologist cannot authorize themself');
await complete(V1, P1, 'CH-1');
let a1 = await one(`select * from ento.job_assignments where visit_id=$1`, [V1]);
ok(a1 && a1.assigned_to === E && a1.verification_status === 'pending', 'completion created a pending assignment for the site entomologist');
ok((await one(`select count(*)::int n from ento.notifications where assigned_to=$1 and kind='job_assigned'`, [E])).n === 1, 'entomologist notified: job_assigned');

console.log('\n2. Row security: only authorized sites, own records');
await as(E);
ok((await q(`select * from ento.v_jobs`)).length === 3, 'E sees every job (all sites, no assignment needed)');
ok((await q(`select * from ops.sites`)).length === 2, 'E sees every site');
ok((await q(`select * from ops.clients`)).length === 2, 'E sees every client');
ok((await q(`select full_name from ops.staff order by 1`)).map((r) => r.full_name).join() === 'Ali PCO,Zain PCO', 'E sees the PCOs on jobs');
ok((await q(`select * from public.leads`)).length === 0 && (await q(`select * from public.proposals`)).length === 0, 'E sees no sales leads / proposals');
ok((await q(`select * from public.profiles`)).length === 1, 'E sees only own profile');
const vj = await one(`select * from ento.v_jobs where visit_id=$1`, [V1]);
ok(vj.client_name === 'Alnoor Foods' && vj.pco_name === 'Ali PCO' && vj.challan_no === 'CH-1' && vj.items[0].name === 'Gel', 'v_jobs carries client, PCO and report details');
await throws(`insert into ento.job_verifications (assignment_id,visit_id,round,decision,created_by,verifier_name) values ($1,$2,1,'verified',$3,'x')`, [a1.id, V1, E], /permission denied/, 'E cannot write tables directly');
await throws(`update ento.job_assignments set verification_status='verified'`, [], /permission denied/, 'E cannot flip a verification status directly');
await throws(`update ops.service_reports set notes='changed'`, [], /permission denied/, 'E cannot edit PCO reports');
await as(E2);
ok((await q(`select * from ento.v_jobs`)).length === 3, 'E2 also sees every job');
ok((await q(`select * from public.leads`)).length === 0, 'E2 still sees no sales data');
await as(O);
ok((await q(`select * from ops.visits`)).length === 3, 'Operations manager still sees all their visits (ops policies unaffected)');

console.log('\n3. Verify / Reject');
await as(E);
await throws(`select ento.decide_job($1,'rejected',null,'too short')`, [a1.id], /reason/, 'reject needs a reason ≥ 10 chars');
await throws(`select ento.decide_job($1,'approved')`, [a1.id], /Verify or Reject/, 'unknown decision refused');
await as(E2);
await as(E);
await q(`select ento.decide_job($1,'rejected',null,'Challan photo missing and gel quantity looks wrong')`, [a1.id]);
a1 = await one(`select * from ento.job_assignments where id=$1`, [a1.id]);
ok(a1.verification_status === 'rejected', 'job rejected');
await throws(`select ento.decide_job($1,'verified')`, [a1.id], /already/, 'cannot decide twice');
await su();
ok((await one(`select count(*)::int n from ento.notifications where kind='job_rejected' and assigned_to in ($1,$2)`, [A, O])).n === 2, 'admin and site manager notified of the rejection');
const vr = await one(`select * from ento.job_verifications where assignment_id=$1`, [a1.id]);
ok(vr.created_by === E && vr.decision === 'rejected' && vr.verifier_name.startsWith('Dr.') && vr.created_at, 'decision recorded with verifier id, name, timestamp');
await throws(`update ento.job_verifications set reason='rewritten'`, [], /permanent/, 'verification records cannot be changed (even by the owner role)');
await throws(`delete from ento.job_verifications`, [], /permanent/, 'verification records cannot be deleted');
await as(O2);
await throws(`select ento.admin_return_for_verification($1,'fixed')`, [a1.id], /Only admin or this site/, 'other ops manager cannot return the job');
await as(O);
await q(`select ento.admin_return_for_verification($1,'Challan re-uploaded, quantity corrected')`, [a1.id]);
a1 = await one(`select * from ento.job_assignments where id=$1`, [a1.id]);
ok(a1.verification_status === 'pending' && a1.round === 2, 'returned for re-verification: pending, round 2');
await su();
ok((await one(`select count(*)::int n from ento.notifications where kind='job_returned' and assigned_to=$1`, [E])).n === 1, 'entomologist notified: job_returned');
await as(E);
await q(`select ento.decide_job($1,'verified','Looks good now',null,'{"treatment":true,"chemicals":true,"photos":true,"report":true}','low')`, [a1.id]);
ok((await one(`select verification_status s from ento.job_assignments where id=$1`, [a1.id])).s === 'verified', 'verified in round 2');
ok((await q(`select * from ento.job_verifications where visit_id=$1`, [V1])).length === 2, 'both decisions kept in history');
ok((await one(`select last_decision d from ento.v_jobs where visit_id=$1`, [V1])).d === 'verified', 'v_jobs shows the latest decision');

console.log('\n4. Revisit request (with photo) → admin approves + schedules → ops completes');
await as(E);
await q(`insert into storage.objects (bucket_id, name) values ('ento-files', $1)`, [`${E}/requests/a.jpg`]);
await throws(`insert into storage.objects (bucket_id, name) values ('ento-files', $1)`, [`${E2}/requests/b.jpg`], /row-level security/, 'cannot upload into another user\'s folder');
await complete(V2, P1, 'CH-2');
await as(E);
const a2 = await one(`select * from ento.job_assignments where visit_id=$1`, [V2]);
await throws(`select ento.submit_request('revisit',$1,$2,'x',null,'Seen it','high',ops.today())`, [S1, V2], /10 characters/, 'description min length enforced');
await throws(`select ento.submit_request('revisit',$1,$2,'x',null,'Activity seen in kitchen','high',ops.today()-1)`, [S1, V2], /today or later/, 'past recommended date refused');
await throws(`select ento.submit_request('revisit',$1,$2,'x',null,'Activity seen in kitchen','high',ops.today(),$3::jsonb)`,
  [S1, V2, JSON.stringify([{ path: `${E}/requests/missing.jpg`, name: 'm.jpg', type: 'image/jpeg', size: 10 }])], /was not uploaded/, 'attachment must exist in storage');
const R1 = (await one(`select ento.submit_request('revisit',$1,$2,'Roaches persist',null,'Live roaches near sink and store room','high',ops.today()+2,$3::jsonb) id`,
  [S1, V2, JSON.stringify([{ path: `${E}/requests/a.jpg`, name: 'a.jpg', type: 'image/jpeg', size: 1000 }])])).id;
let r1 = await one(`select * from ento.v_requests where id=$1`, [R1]);
ok(r1.status === 'submitted' && r1.code.startsWith('REQ-') && r1.client_name === 'Alnoor Foods', 'request submitted, linked to client/site/job');
ok((await one(`select verification_status s from ento.job_assignments where id=$1`, [a2.id])).s === 'revisit_requested', 'revisit on a pending job records the decision');
ok((await q(`select * from ento.attachments where entity_id=$1`, [R1])).length === 1, 'photo attached');
await throws(`select ento.admin_decide_request($1,'approved','ok')`, [R1], /Only admin/, 'entomologist cannot approve own request');
await throws(`select ento.admin_schedule_request($1,ops.today()+3,'09:00',null)`, [R1], /Only admin/, 'entomologist cannot schedule / assign PCO');
await as(E2);
ok((await q(`select * from ento.activity_requests`)).length === 0, 'other entomologist cannot see the request');
await as(A);
await throws(`select ento.admin_decide_request($1,'rejected','')`, [R1], /why/, 'rejection needs a note');
await q(`select ento.admin_decide_request($1,'approved','Approved, Ali will go',ops.today()+3,'09:00',$2)`, [R1, P1]);
await su();
r1 = await one(`select * from ento.activity_requests where id=$1`, [R1]);
ok(r1.status === 'scheduled' && r1.assigned_pco === P1 && r1.scheduled_visit_id, 'approved + scheduled with PCO');
const rv = await one(`select * from ops.visits where id=$1`, [r1.scheduled_visit_id]);
ok(rv.kind === 'revisit' && rv.status === 'scheduled' && rv.site_id === S1 && rv.job_code, 'revisit job created in Operations (visible in ops portal)');
const kinds = (await q(`select kind from ento.notifications where assigned_to=$1 and entity_id=$2 order by created_at`, [E, R1])).map((r) => r.kind);
ok(kinds.includes('request_decided') && kinds.includes('request_scheduled'), 'entomologist notified: approved + scheduled', kinds.join());
await su();
await q(`update ops.visits set visit_date = visit_date + 1, visit_time = '11:00' where id = $1`, [rv.id]);
await su();
r1 = await one(`select * from ento.activity_requests where id=$1`, [R1]);
ok(r1.scheduled_time === '11:00', 'request schedule follows when Operations reschedules the visit');
await complete(rv.id, P1, 'CH-3');
ok((await one(`select status from ento.activity_requests where id=$1`, [R1])).status === 'completed', 'request completed when the revisit is done');
ok((await one(`select assigned_to, verification_status s from ento.job_assignments where visit_id=$1`, [rv.id])).s === 'pending', 'the revisit job itself now waits for verification');

console.log('\n5. Inspection request → approve → schedule later → inspection report');
await as(E);
const R2 = (await one(`select ento.submit_request('inspection',$1,null,null,'Quarterly rodent check','Burrows near the loading bay','medium',ops.today()+5) id`, [S1])).id;
await as(A);
await q(`select ento.admin_decide_request($1,'approved',null)`, [R2]);
ok((await one(`select status from ento.activity_requests where id=$1`, [R2])).status === 'approved', 'approved without a date stays approved');
await q(`select ento.admin_schedule_request($1,ops.today()+6,'12:00',null)`, [R2]);
const iv = (await one(`select scheduled_visit_id v from ento.activity_requests where id=$1`, [R2])).v;
await as(O);
await q(`select ops.submit_inspection_report($1,'Medium','Treat again','Loading bay, store','Burrows found')`, [iv]);
await as(E);
ok((await one(`select status from ento.v_requests where id=$1`, [R2])).status === 'completed', 'inspection request completed');
ok((await q(`select * from ento.v_inspections where site_id=$1`, [S1])).length === 1, 'site inspection visible in site report');
await q(`select ento.cancel_request($1)`, [R2]).then(() => ok(false, 'cannot withdraw a completed request')).catch((e) => ok(/no longer be withdrawn/.test(e.message), 'cannot withdraw a completed request'));

console.log('\n5b. Revisit sent straight to Operations (no admin approval)');
await su();
const VD = await mkVisit(S1, P1, today);
await complete(VD, P1, 'CH-D');
await as(E);
await throws(`select ento.send_revisit($1,'Roaches back','short',ops.today()+1,'09:30')`, [VD], /10 characters/, 'revisit needs a problem description');
await throws(`select ento.send_revisit($1,'Roaches back','Live roaches near the sink again',ops.today()-1,'09:30')`, [VD], /today or a later/, 'revisit date cannot be in the past');
const notesBefore = (await one(`select count(*)::int n from ento.notifications`)).n;
const RD = (await one(`select ento.send_revisit($1,'Roaches back','Live roaches near the sink again',ops.today()+1,'09:30') id`, [VD])).id;
const rd = await one(`select * from ento.activity_requests where id=$1`, [RD]);
ok(rd.status === 'scheduled' && rd.scheduled_visit_id && rd.scheduled_time === '09:30', 'revisit is scheduled immediately at the chosen time');
ok((await one(`select verification_status s from ento.job_assignments where visit_id=$1`, [VD])).s === 'revisit_requested', 'pending job marked revisit requested');
ok((await one(`select count(*)::int n from ento.notifications`)).n === notesBefore, 'no self-notification for your own revisit');
await su();
const dv = await one(`select * from ops.visits where id=$1`, [rd.scheduled_visit_id]);
ok(dv.kind === 'revisit' && dv.site_id === S1, 'Operations gets the revisit at the site');
const orig = await one(`select treatments, pco_id, job_code from ops.visits where id=$1`, [VD]);
ok(JSON.stringify(dv.treatments) === JSON.stringify(orig.treatments) && dv.treatments.length > 0, 'revisit repeats the job\'s treatment', JSON.stringify(dv.treatments));
ok(dv.pco_id === orig.pco_id && dv.status === 'scheduled', 'same PCO as the job, so it is scheduled straight away');
ok(dv.note.startsWith('Entomologist revisit ' + rd.code + ' of ' + orig.job_code) && dv.note.includes('Roaches back'), 'note marks it as an entomologist revisit, of which job, and why', dv.note);
ok((await one(`select assigned_pco from ento.activity_requests where id=$1`, [RD])).assigned_pco === orig.pco_id, 'request shows the PCO the visit got');
await q(`update ops.staff set active = false where id=$1`, [orig.pco_id]);
await as(E);
const RD2 = (await one(`select ento.send_revisit($1,'Again','Still live roaches near the sink',ops.today()+3,'11:00') id`, [VD])).id;
await su();
const dv2 = await one(`select v.* from ops.visits v join ento.activity_requests r on r.scheduled_visit_id = v.id where r.id=$1`, [RD2]);
ok(dv2.status === 'needs_pco' && dv2.pco_id === null, 'if that PCO is no longer active, it waits for the manager to pick one');
await q(`update ops.staff set active = true where id=$1`, [orig.pco_id]);
ok((await one(`select count(*)::int n from ento.notifications where entity_id=$1 and assigned_to in ($2,$3)`, [RD, A, O])).n === 2, 'admin and site manager notified');
await as(A);
await throws(`select ento.send_revisit($1,'x','Live roaches near the sink again',ops.today()+1,'09:30')`, [VD], /Only entomologist/, 'only entomologists send revisits');

console.log('\n5c. Complaint from the Verify tab (unclear photos) keeps the job pending');
await su();
const VQ = await mkVisit(S2, P2, today);
await complete(VQ, P2, 'CH-Q');
await as(E);
const KQ = (await one(`select ento.lodge_complaint($1,$2,'report_quality','Challan photo is blurry, cannot read the signature','medium') id`, [S2, VQ])).id;
ok((await one(`select category from ento.complaints where id=$1`, [KQ])).category === 'report_quality', 'report-quality complaint lodged on the job');
ok((await one(`select verification_status s from ento.job_assignments where visit_id=$1`, [VQ])).s === 'pending', 'job stays pending after the complaint');
ok((await one(`select count(*)::int n from ento.notifications where entity_id=$1`, [KQ])).n === 0, 'entomologist gets no self-notification');
await su();
ok((await one(`select count(*)::int n from ento.notifications where entity_id=$1 and assigned_to=$2`, [KQ, A])).n === 1, 'admin notified of the complaint');
await db.exec(read(M5).replace(/notify pgrst[^;]*;/g, ''));
ok(true, 'migration 5 can be run again');

console.log('\n6. Complaints');
await as(E);
const K1 = (await one(`select ento.lodge_complaint($1,$2,'pco_performance','PCO left early without finishing the store room','critical') id`, [S1, V1])).id;
ok((await one(`select status from ento.v_complaints where id=$1`, [K1])).status === 'submitted', 'complaint submitted');
await q(`select ento.comment_complaint($1,'Client manager confirmed this')`, [K1]);
await as(A);
await q(`select ento.admin_update_complaint($1,'under_review','Looking into it')`, [K1]);
await throws(`select ento.admin_update_complaint($1,'submitted','back')`, [K1], /back to/, 'complaint status cannot go backwards');
await throws(`select ento.admin_update_complaint($1,'assigned','x')`, [K1], /who handles/, 'assigned needs a handler');
await q(`select ento.admin_update_complaint($1,'assigned','Omar will handle',$2)`, [K1, O]);
await as(O);
await q(`select ento.admin_update_complaint($1,'in_progress','PCO retrained')`, [K1]);
await q(`select ento.admin_update_complaint($1,null,'Revisit booked for Monday')`, [K1]);
await as(A);
await q(`select ento.admin_update_complaint($1,'resolved','Fixed')`, [K1]);
await q(`select ento.admin_update_complaint($1,'closed','Closing')`, [K1]);
await as(E);
const ku = await q(`select kind, to_status from ento.complaint_updates where complaint_id=$1 order by created_at`, [K1]);
ok(ku.length === 8, 'full trail of updates kept', JSON.stringify(ku));
ok((await one(`select count(*)::int n from ento.notifications where kind='complaint_updated' and assigned_to=$1`, [E])).n === 6, 'entomologist notified of each admin update');
await throws(`select ento.comment_complaint($1,'more')`, [K1], /closed/, 'no comments once closed');
await as(E2);
ok((await q(`select * from ento.complaints`)).length === 0, 'other entomologist cannot see the complaint');

console.log('\n7. Meetings');
await as(E);
await throws(`select ento.admin_save_meeting(null,'x',now()+interval '1 day',null,'HQ',null,null,array[$1]::uuid[])`, [E], /Only admin/, 'entomologist cannot create meetings');
await as(A);
const M1 = (await one(`select ento.admin_save_meeting(null,'Monthly review',now()+interval '1 day',now()+interval '1 day 1 hour','Head office',null,'1. Rejections',array[$1]::uuid[]) id`, [E])).id;
await as(E);
ok((await q(`select * from ento.v_my_meetings`)).length === 1, 'invited entomologist sees the meeting');
ok((await one(`select count(*)::int n from ento.notifications where kind='meeting_scheduled' and assigned_to=$1`, [E])).n === 1, 'notified: meeting_scheduled');
await q(`select ento.respond_meeting($1,'confirmed')`, [M1]);
await throws(`select ento.respond_meeting($1,null,'attended')`, [M1], /30 minutes/, 'attendance cannot be marked a day early');
await q(`select ento.respond_meeting($1,null,null,'Bring rejection stats')`, [M1]);
ok((await one(`select rsvp, my_notes from ento.v_my_meetings where id=$1`, [M1])).rsvp === 'confirmed', 'RSVP saved');
await as(E2);
ok((await q(`select * from ento.v_my_meetings`)).length === 0 && (await q(`select * from ento.meetings`)).length === 0, 'uninvited entomologist cannot see it');
await throws(`select ento.respond_meeting($1,'confirmed')`, [M1], /not invited/, 'uninvited cannot respond');
await as(A);
await q(`select ento.admin_save_meeting($1,'Monthly review',now()+interval '2 day',null,'Head office',null,'1. Rejections',array[$2]::uuid[])`, [M1, E]);
ok((await one(`select status from ento.meetings where id=$1`, [M1])).status === 'rescheduled', 'moving the time marks it rescheduled');
await q(`select ento.admin_cancel_meeting($1,'Clash with audit')`, [M1]);
await as(E);
const mk = (await q(`select kind from ento.notifications where assigned_to=$1 and entity_id=$2`, [E, M1])).map((r) => r.kind).sort().join();
ok(mk === 'meeting_cancelled,meeting_changed,meeting_scheduled', 'notified: scheduled, changed, cancelled', mk);
await throws(`select ento.respond_meeting($1,'confirmed')`, [M1], /cancelled/, 'cannot respond to a cancelled meeting');
await as(A);
const M2 = (await one(`select ento.admin_save_meeting(null,'Site walk',now()-interval '10 minutes',null,null,'https://meet.example/abc',null,array[$1]::uuid[]) id`, [E])).id;
await as(E);
await q(`select ento.respond_meeting($1,null,'attended')`, [M2]);
ok((await one(`select attendance from ento.v_my_meetings where id=$1`, [M2])).attendance === 'attended', 'attendance marked once the meeting has started');

console.log('\n8. Unassigned site, verifier assignment, notifications, audit, storage');
await complete(VS2, P2, 'CH-9');
const as2 = await one(`select * from ento.job_assignments where visit_id=$1`, [VS2]);
ok(as2.assigned_to === null && as2.verification_status === 'pending', 'job at a site with no entomologist waits unassigned (never auto-verified)');
ok((await one(`select count(*)::int n from ento.notifications where kind='job_assigned' and entity_id=$1 and assigned_to in ($2,$3)`, [VS2, E, E2])).n === 2, 'all entomologists told the job is ready');
await as(A);
await throws(`select ento.admin_assign_verifier($1,$2)`, [VS2, O], /not an entomologist/, 'a named verifier must be an entomologist');
await as(E2);
ok((await one(`select count(*)::int n from ento.notifications where assigned_to <> $1`, [E2])).n === 0
   && (await one(`select count(*)::int n from ento.notifications`)).n > 0, 'E2 sees only own notifications');
await q(`select ento.decide_job($1,'verified','Checked')`, [as2.id]);
ok((await one(`select created_by from ento.job_verifications where assignment_id=$1`, [as2.id])).created_by === E2, 'any entomologist can verify an unassigned job; verifier recorded');
await as(E);
await throws(`select ento.decide_job($1,'rejected',null,'Too late, already verified by a colleague')`, [as2.id], /already/, 'a job is decided only once per round');
await su();
const VB = await mkVisit(S2, P2, today);
await db.exec('alter table ops.service_reports disable trigger ento_job_completed');
await complete(VB, P2, 'CH-OLD');
await db.exec('alter table ops.service_reports enable trigger ento_job_completed');
await db.exec(read(M3).replace(/notify pgrst[^;]*;/g, ''));
ok((await one(`select verification_status s from ento.job_assignments where visit_id=$1`, [VB])).s === 'pending', 'jobs completed before the portal are queued as pending (migration 3 backfill, re-runnable)');
await as(E);
const unread = (await one(`select count(*)::int n from ento.notifications where read_at is null`)).n;
await q(`select ento.mark_notifications_read(null)`);
ok(unread > 0 && (await one(`select count(*)::int n from ento.notifications where read_at is null`)).n === 0, 'mark all read');
ok((await q(`select * from ento.audit_log where created_by <> $1`, [E])).length === 0, 'entomologist reads only their own audit rows');
await as(A);
const acts = (await q(`select distinct action from ento.audit_log`)).map((r) => r.action);
ok(['job.rejected', 'job.verified', 'job.returned', 'request.approved', 'request.scheduled', 'complaint.update', 'meeting.cancelled'].every((x) => acts.includes(x)), 'audit log covers verification and admin actions', acts.join());
await su();
await q(`update ops.service_reports set notes='edited later' where visit_id=$1`, [V1]);
ok((await one(`select count(*)::int n from ento.audit_log where action='report.update' and entity_id=$1`, [V1])).n === 1, 'a later edit of a PCO report keeps the old version');
await q(`insert into storage.objects (bucket_id, name, owner) values ('ops-files',$1,$2),('ops-files',$3,$2)`, [`${V1}/challan/c.jpg`, O, `${VS2}/challan/c.jpg`]);
await as(E);
ok((await q(`select name from storage.objects where bucket_id='ops-files'`)).length === 2, 'E can read job photos');
await as(E2);
ok((await q(`select name from storage.objects where bucket_id='ento-files'`)).length === 0, "E2 cannot read E's uploads");
await as(A);
ok((await q(`select name from storage.objects where bucket_id='ento-files'`)).length === 1, 'admin can read attached uploads');

console.log('\n9. Sample data (dev seed) loads through the real functions and cleans up');
await su();
const SEED = 'ikpm-entomologist/supabase/seed/dev-sample-data.sql';
const seedSql = read(SEED)
  .replace("v_email   text := 'entomologist@example.com'", "v_email   text := 'ento@x.pk'")
  .replace("v_confirm text := 'no'", "v_confirm text := 'dev'");
try { await db.exec(read(SEED)); ok(false, 'seed refuses to run without confirmation'); }
catch (e) { ok(/development only/.test(e.message), 'seed refuses to run without confirmation', e.message); }
await db.exec(seedSql);
await as(E);
const sj = await q(`select verification_status s, count(*)::int n from ento.v_jobs
                     where client_name like '%(sample)' and assigned_to = $1 group by 1`, [E]);
const by = Object.fromEntries(sj.map((r) => [r.s, r.n]));
ok(by.verified === 5 && by.rejected === 2 && by.revisit_requested === 1 && by.pending >= 3, 'sample jobs: verified / rejected / revisit / pending', JSON.stringify(by));
ok((await q(`select * from ento.v_jobs where site_name = 'Gulberg Hotel'`)).length > 0, 'every sample site is visible');
ok((await q(`select * from ento.v_jobs where visit_status = 'scheduled' and client_name like '%(sample)'`)).length > 0, 'upcoming sample jobs exist for the calendar');
ok((await q(`select * from ento.v_requests where client_name like '%(sample)'`)).length === 2, 'sample revisit + inspection requests');
ok((await q(`select * from ento.v_my_meetings where title in ('Monthly verification review', 'Pesticide safety refresher')`)).length === 2, 'sample meetings');
ok((await one(`select treatments from ento.v_jobs where client_name like '%(sample)' limit 1`)).treatments.length === 2, 'treatments stored as a flat list');
await su();
await db.exec(read('ikpm-entomologist/supabase/seed/dev-sample-data-cleanup.sql'));
const left = await one(`select (select count(*) from ops.sites where id::text like '5eed%')
  + (select count(*) from ops.staff where id::text like '5eed%')
  + (select count(*) from ento.job_assignments where site_id::text like '5eed%') as n`);
ok(Number(left.n) === 0, 'cleanup removes all sample rows');
ok((await one(`select count(*)::int n from ento.job_verifications`)).n > 0, 'cleanup keeps the non-sample decisions');
await db.exec(seedSql);
ok(true, 'sample data can be loaded again after cleanup');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
