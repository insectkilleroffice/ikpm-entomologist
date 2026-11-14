-- Removes everything dev-sample-data.sql created (ids starting with 5eed) and the
-- records made on top of it (assignments, decisions, requests, complaints, meetings,
-- notifications, the visits admin created for sample requests). Nothing else is touched.
-- Development projects only.

begin;

create temp table _sites  on commit drop as select id from ops.sites  where id::text like '5eed%';
create temp table _visits on commit drop as select id from ops.visits where site_id in (select id from _sites);

-- Decision history and the audit log are permanent by design; allow removing sample rows only here.
alter table ento.job_verifications disable trigger job_verifications_permanent;
alter table ento.audit_log disable trigger audit_log_permanent;

delete from ento.notifications n
 where n.entity_id in (select id from _visits)
    or n.entity_id in (select id from ento.activity_requests where site_id in (select id from _sites))
    or n.entity_id in (select id from ento.complaints where site_id in (select id from _sites))
    or n.entity_id in (select m.id from ento.meetings m where m.scheduled_by_name is not null
                         and m.title in ('Monthly verification review', 'Client walk-through: Mall Road Hotel', 'Pesticide safety refresher'));
delete from ento.audit_log where entity_id in (select id from _visits)
   or entity_id in (select id from ento.job_assignments where site_id in (select id from _sites))
   or entity_id in (select id from ento.activity_requests where site_id in (select id from _sites))
   or entity_id in (select id from ento.complaints where site_id in (select id from _sites))
   or entity_id in (select id from _sites);
delete from ento.attachments where entity_id in (select id from ento.activity_requests where site_id in (select id from _sites))
   or entity_id in (select id from ento.complaints where site_id in (select id from _sites));
delete from ento.job_verifications where visit_id in (select id from _visits);
delete from ento.job_assignments where site_id in (select id from _sites);
delete from ento.activity_requests where site_id in (select id from _sites);
delete from ento.complaints where site_id in (select id from _sites);
delete from ento.meetings where title in ('Monthly verification review', 'Client walk-through: Mall Road Hotel', 'Pesticide safety refresher');
delete from ento.site_access where site_id in (select id from _sites);

alter table ento.job_verifications enable trigger job_verifications_permanent;
alter table ento.audit_log enable trigger audit_log_permanent;

delete from ops.site_issues where site_id in (select id from _sites);
delete from ops.visits where id in (select id from _visits);          -- reports and history cascade
delete from ops.complaints where site_id in (select id from _sites);
delete from ops.sites where id in (select id from _sites);
delete from ops.clients where id::text like '5eed%';
delete from ops.staff where id::text like '5eed%';

commit;
