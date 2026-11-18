/**
 * Every change this portal makes. Each action validates the input (so forms show the same
 * field errors), then saves into the in-memory sample store (lib/demo-data.ts) so the screens
 * update — until the page is reloaded. Connect a backend by replacing the "save" step in each action.
 *
 * What the entomologist can do:
 *   - verify a completed job, or mark it as a complaint (service issue / document issue, reason required);
 *   - add a note to one of their complaints;
 *   - submit the report of an inspection Admin assigned to them;
 *   - answer meetings, and read notifications.
 */
import { validator } from "@/lib/validate";
import { todayYmd } from "@/lib/time";
import { applyLast, DEMO_SITES, ME_NAME, newDemoId, nowIso, store } from "@/lib/demo-data";
import type { ActionResult } from "@/lib/types";

/** Tell every open screen to reload (same event name as LIVE_EVENT in lib/client-data.ts). */
const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("ento:change")); };
const code = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, "0")}`;

/** Gap classification of a finding (Low / Moderate / High / Severe). */
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
/** Placeholder user folder for attachment checks (see lib/auth.ts). */
const USER = "00000000-0000-4000-8000-000000000000";

/** Feels like a round trip, so pending states still show. */
const pause = () => new Promise((r) => setTimeout(r, 250));

/** A job waiting for this entomologist's decision, or an error result. */
function pendingJob(assignmentId: string) {
  const job = store.jobs.find((j) => j.assignment_id === assignmentId);
  if (!job) return { error: { ok: false as const, error: "This job is no longer assigned to you." } };
  if (job.verification_status !== "pending") return { error: { ok: false as const, error: "This job was already decided." } };
  return { job };
}

/* ---------- Job verification ---------- */

export async function verifyJob(input: { assignmentId: string; note?: string }): Promise<ActionResult> {
  await pause();
  const v = validator();
  v.uuid("assignmentId", input.assignmentId, "the job");
  const note = v.text("note", input.note, { label: "Note", max: 2000 });
  const bad = v.result();
  if (bad) return bad;
  const p = pendingJob(input.assignmentId);
  if (p.error) return p.error;
  const job = p.job;
  store.verifs.push({
    id: newDemoId("b3"), assignment_id: job.assignment_id!, visit_id: job.visit_id, round: job.round ?? 1, decision: "verified",
    issue: null, note, complaint_id: null, created_by: USER, verifier_name: ME_NAME, created_at: nowIso(),
  });
  job.verification_status = "verified";
  applyLast(job, store.verifs);
  // A verified complaint service closes its complaint.
  const c = job.complaint_id ? store.complaints.find((x) => x.id === job.complaint_id) : undefined;
  if (c && c.status !== "resolved") Object.assign(c, { status: "resolved", resolved_at: nowIso(), updated_at: nowIso() });
  changed();
  return { ok: true, message: "Job verified." };
}

/**
 * Marks a completed service as a complaint. Operations then acts on it:
 *   service  → the site is marked as a complaint and a complaint service is scheduled;
 *   document → the documents and pictures are corrected and the job comes back to verify.
 */
export async function markJobComplaint(input: { assignmentId: string; issue: string; reason: string }): Promise<ActionResult<{ id: string }>> {
  await pause();
  const v = validator();
  v.uuid("assignmentId", input.assignmentId, "the job");
  const issue = v.oneOf("issue", input.issue, ["service", "document"] as const, "service issue or document issue");
  const reason = v.text("reason", input.reason, { label: "Reason", required: true, min: 10, max: 2000 });
  const bad = v.result();
  if (bad) return bad;
  const p = pendingJob(input.assignmentId);
  if (p.error) return p.error;
  const job = p.job;
  const id = newDemoId("e1");
  const now = nowIso();
  store.complaints.unshift({
    id, code: code("CMP", store.complaints.length + 1), client_id: job.client_id, site_id: job.site_id, visit_id: job.visit_id,
    issue: issue!, description: reason!, status: "submitted", created_by: USER, created_by_name: ME_NAME,
    resolved_at: null, created_at: now, updated_at: now,
    site_name: job.site_name, client_name: job.client_name, job_code: job.job_code, job_date: job.visit_date,
    service_visit_id: null, service_job_code: null, service_date: null,
  });
  store.verifs.push({
    id: newDemoId("b3"), assignment_id: job.assignment_id!, visit_id: job.visit_id, round: job.round ?? 1, decision: "complaint",
    issue: issue!, note: reason, complaint_id: id, created_by: USER, verifier_name: ME_NAME, created_at: now,
  });
  job.verification_status = "complaint";
  applyLast(job, store.verifs);
  changed();
  return {
    ok: true, data: { id },
    message: issue === "service"
      ? "Complaint sent to Operations. They will mark this site as a complaint and schedule a complaint service."
      : "Complaint sent to Operations. They will correct the documents and pictures and send the job back to you.",
  };
}

/* ---------- Complaints ---------- */

export async function commentComplaint(id: string, message: string): Promise<ActionResult> {
  await pause();
  const v = validator();
  const text = v.text("message", message, { label: "Message", required: true, max: 4000 });
  const bad = v.result();
  if (bad) return bad;
  store.updates.push({ id: newDemoId("e2"), complaint_id: id, kind: "comment", from_status: null, to_status: null, message: text, created_by: USER, author_name: ME_NAME, author_role: "entomologist", created_at: nowIso() });
  changed();
  return { ok: true, message: "Note added." };
}

/* ---------- Inspection report (visit + findings) ---------- */

export type SiteVisitInput = {
  inspectionId: string;
  visitDate: string;
  pestActivity?: string;
  notes?: string;
  checks?: { findingId: string; result: "fixed" | "not_fixed"; note?: string }[];
  findings?: {
    category: string; department?: string; area?: string; description: string; risk?: string; recommendation?: string;
    severity: string; responsibility?: string; files?: unknown;
  }[];
  files?: unknown;
};

/** The report of an assigned inspection: re-check earlier findings (fixed / not fixed), add new findings, notes and photos. */
export async function submitInspectionReport(input: SiteVisitInput): Promise<ActionResult<{ id: string }>> {
  await pause();
  const v = validator();
  v.uuid("inspectionId", input.inspectionId, "the inspection");
  const date = v.date("visitDate", input.visitDate, { label: "Inspection date", required: true });
  if (date && date > todayYmd()) v.errors.visitDate = "The inspection date cannot be in the future";
  const pest = v.oneOf("pestActivity", input.pestActivity, ["none", "low", "medium", "high"] as const, "pest activity level", false);
  const notes = v.text("notes", input.notes, { label: "Notes", max: 4000 });
  const visitFiles = v.files("files", input.files, USER);

  const checks = (Array.isArray(input.checks) ? input.checks : []).map((c, i) => ({
    finding_id: v.uuid(`check${i}`, c?.findingId, "the finding"),
    result: v.oneOf(`check${i}`, c?.result, ["fixed", "not_fixed"] as const, "fixed or not fixed"),
    note: v.text(`checkNote${i}`, c?.note, { label: "Note", max: 2000 }),
  }));
  const raw = Array.isArray(input.findings) ? input.findings : [];
  if (raw.length > 20) v.errors.findings = "Add at most 20 new findings per inspection";
  const findings = raw.slice(0, 20).map((f, i) => {
    v.oneOf(`category${i}`, f?.category, ["structural", "hygiene", "housekeeping", "pest_activity", "waste", "other"] as const, "the category");
    v.text(`department${i}`, f?.department, { label: "Department", max: 200 });
    v.text(`area${i}`, f?.area, { label: "Location", max: 200 });
    v.text(`finding${i}`, f?.description, { label: "Observation", required: true, min: 5, max: 2000 });
    v.text(`risk${i}`, f?.risk, { label: "Risk", max: 1000 });
    v.text(`recommendation${i}`, f?.recommendation, { label: "Recommendation", max: 1000 });
    v.oneOf(`severity${i}`, f?.severity, SEVERITIES, "the gap classification");
    v.oneOf(`responsibility${i}`, f?.responsibility, ["client", "ikpm", "shared"] as const, "who is responsible", false);
    return { ...f, uploaded: v.files(`findingFiles${i}`, f?.files, USER) };
  });
  if (!notes && !checks.length && !findings.length) v.errors.notes = "Add a finding, check an earlier finding, or write a note";
  const bad = v.result();
  if (bad) return bad;

  const task = store.tasks.find((t) => t.id === input.inspectionId);
  if (!task) return { ok: false, error: "This inspection is not assigned to you." };
  if (task.status === "submitted") return { ok: false, error: "The report of this inspection was already submitted." };
  if (task.inspection_date > todayYmd()) return { ok: false, error: `You can submit this report from ${task.inspection_date}, the inspection date.` };
  const s = DEMO_SITES.find((x) => x.site_id === task.site_id)!;
  const id = newDemoId("71");
  const created = nowIso();
  const visitCode = code("SV", store.visits.length + 1);
  store.visits.unshift({
    id, code: visitCode, inspection_id: task.id, site_id: s.site_id, site_name: s.site_name, site_city: s.city, client_id: s.client_id, client_name: s.client_name,
    visit_date: date!, pest_activity: pest, notes, created_by: USER, created_by_name: ME_NAME, created_at: created,
  });
  addAttachments("site_visit", id, visitFiles);
  for (const c of checks) {
    store.checks.push({ id: newDemoId("73"), finding_id: c.finding_id!, site_visit_id: id, result: c.result!, note: c.note, created_by: USER, created_by_name: ME_NAME, created_at: created });
    const f = store.findings.find((x) => x.id === c.finding_id);
    if (f && c.result === "fixed") Object.assign(f, { status: "fixed", fixed_visit_id: id, fixed_on: date, fixed_by_name: ME_NAME });
  }
  for (const f of findings) {
    const fid = newDemoId("72");
    store.findings.push({
      id: fid, code: `F-${String(store.findings.length + 1).padStart(3, "0")}`, site_id: s.site_id, site_name: s.site_name, site_city: s.city, client_id: s.client_id, client_name: s.client_name,
      area: f.area?.trim() || null, description: f.description.trim(), severity: f.severity, category: f.category, department: f.department?.trim() || null,
      risk: f.risk?.trim() || null, recommendation: f.recommendation?.trim() || null, responsibility: f.responsibility || null, status: "open",
      found_visit_id: id, found_visit_code: visitCode, found_on: date!, fixed_visit_id: null, fixed_on: null, fixed_by_name: null,
      created_by: USER, created_by_name: ME_NAME, created_at: created, last_result: null, last_checked_on: null, last_checked_by: null, times_not_fixed: 0,
    });
    addAttachments("site_finding", fid, f.uploaded);
  }
  Object.assign(task, { status: "submitted", site_visit_id: id, submitted_at: created });
  changed();

  const fixed = checks.filter((c) => c.result === "fixed").length;
  return {
    ok: true, data: { id },
    message: `Report submitted${findings.length ? ` · ${findings.length} new finding${findings.length > 1 ? "s" : ""}` : ""}${fixed ? ` · ${fixed} fixed` : ""}.`,
  };
}

function addAttachments(entity_type: string, entity_id: string, files: { path: string; name: string; type: string; size: number }[]) {
  for (const f of files) {
    const id = newDemoId("92");
    store.attachments.push({ id, entity_type, entity_id, bucket: "ento-files", path: `${USER}/${entity_type}/${id}/${f.path.split("/").pop()}`, file_name: f.name, mime_type: f.type, size_bytes: f.size, created_at: nowIso() });
  }
}

/* ---------- Meetings ---------- */

export type MeetingResponseInput = {
  meetingId: string;
  rsvp?: "confirmed" | "declined";
  attendance?: "attended" | "absent";
  notes?: string;
};

export async function respondMeeting(input: MeetingResponseInput): Promise<ActionResult> {
  await pause();
  const v = validator();
  const rsvp = v.oneOf("rsvp", input.rsvp, ["confirmed", "declined"] as const, "confirm or decline", false);
  const att = v.oneOf("attendance", input.attendance, ["attended", "absent"] as const, "attendance", false);
  const notes = input.notes === undefined ? null : (v.text("notes", input.notes, { label: "Notes", max: 4000 }) ?? "");
  const bad = v.result();
  if (bad) return bad;
  if (!rsvp && !att && notes === null) return { ok: false, error: "Nothing to save." };
  const m = store.meetings.find((x) => x.id === input.meetingId);
  if (!m) return { ok: false, error: "You are not invited to this meeting." };
  if (m.status === "cancelled") return { ok: false, error: "This meeting was cancelled." };
  if (rsvp) Object.assign(m, { rsvp, rsvp_at: nowIso() });
  if (att) {
    if (Date.now() < Date.parse(m.starts_at) - 30 * 60_000) return { ok: false, error: "Attendance opens 30 minutes before the meeting starts." };
    Object.assign(m, { attendance: att, attendance_at: nowIso() });
  }
  if (notes !== null) m.my_notes = notes || null;
  changed();
  return {
    ok: true,
    message: rsvp === "confirmed" ? "Attendance confirmed." : rsvp === "declined" ? "Meeting declined." : att ? "Attendance marked." : "Notes saved.",
  };
}

/* ---------- Notifications ---------- */

export async function markNotificationsRead(ids?: string[]): Promise<ActionResult> {
  const now = nowIso();
  for (const n of store.notifications) if (!n.read_at && (!ids || ids.includes(n.id))) n.read_at = now;
  changed();
  return { ok: true };
}
