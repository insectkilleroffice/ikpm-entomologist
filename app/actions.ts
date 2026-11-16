/* eslint-disable @typescript-eslint/no-unused-vars -- UI-only stubs keep their real signatures */
/**
 * Every change this portal makes. UI only: each action validates the input (so forms show
 * the same field errors) and returns the same message, but nothing is saved — there is no
 * backend. Connect one by replacing the "save" step in each action.
 */
import { validator } from "@/lib/validate";
import { todayYmd } from "@/lib/time";
import type { ActionResult } from "@/lib/types";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = [
  "poor_treatment_quality", "pest_activity_present", "client_dissatisfaction",
  "pco_performance", "chemical_safety", "site_hygiene", "report_quality", "other",
] as const;
/** Placeholder user folder for attachment checks (see lib/auth.ts). */
const USER = "00000000-0000-4000-8000-000000000000";

/** Feels like a round trip, so pending states still show. */
const pause = () => new Promise((r) => setTimeout(r, 250));
const newId = () => crypto.randomUUID();

/* ---------- Job verification ---------- */

export type DecideJobInput = {
  assignmentId: string;
  decision: "verified" | "rejected";
  remarks?: string;
  reason?: string;
  checks?: { treatment?: boolean; chemicals?: boolean; photos?: boolean; report?: boolean };
  pestActivity?: string;
  files?: unknown;
};

export async function decideJob(input: DecideJobInput): Promise<ActionResult> {
  await pause();
  const v = validator();
  v.uuid("assignmentId", input.assignmentId, "the job");
  const decision = v.oneOf("decision", input.decision, ["verified", "rejected"] as const, "Verify or Reject");
  v.text("remarks", input.remarks, { label: "Remarks", max: 2000 });
  v.text("reason", input.reason, {
    label: "Reason for rejection", required: decision === "rejected", min: decision === "rejected" ? 10 : 0, max: 2000,
  });
  v.oneOf("pestActivity", input.pestActivity, ["none", "low", "medium", "high"] as const, "pest activity level", false);
  v.files("files", input.files, USER);
  const bad = v.result();
  if (bad) return bad;
  return { ok: true, message: decision === "verified" ? "Job verified." : "Job rejected and returned for correction." };
}

/* ---------- Revisit / inspection requests ---------- */

export type RequestInput = {
  type: "revisit" | "inspection";
  siteId: string;
  visitId?: string;
  reason?: string;
  purpose?: string;
  description: string;
  priority: string;
  recommendedDate: string;
  files?: unknown;
};

export async function submitRequest(input: RequestInput): Promise<ActionResult<{ id: string }>> {
  await pause();
  const v = validator();
  const type = v.oneOf("type", input.type, ["revisit", "inspection"] as const, "the request type");
  v.uuid("siteId", input.siteId, "the branch / site");
  v.uuid("visitId", input.visitId, "the previous job", type === "revisit");
  if (type === "revisit") v.text("reason", input.reason, { label: "Reason for revisit", required: true, max: 500 });
  if (type === "inspection") v.text("purpose", input.purpose, { label: "Inspection purpose", required: true, max: 500 });
  v.text("description", input.description, {
    label: type === "inspection" ? "Observations" : "Pest activity / problem", required: true, min: 10, max: 4000,
  });
  v.oneOf("priority", input.priority, PRIORITIES, "the priority");
  v.date("recommendedDate", input.recommendedDate, { label: "Recommended date", required: true, min: todayYmd() });
  v.files("files", input.files, USER);
  const bad = v.result();
  if (bad) return bad;
  return { ok: true, data: { id: newId() }, message: "Request sent to Admin for approval." };
}

/** Revisit straight to Operations (no admin approval). */
export async function sendRevisit(input: { visitId: string; reason: string; description: string; date: string; time: string }): Promise<ActionResult<{ id: string }>> {
  await pause();
  const v = validator();
  v.uuid("visitId", input.visitId, "the job");
  v.text("reason", input.reason, { label: "Reason for revisit", required: true, max: 500 });
  v.text("description", input.description, { label: "Problem", required: true, min: 10, max: 4000 });
  v.date("date", input.date, { label: "Date", required: true, min: todayYmd() });
  // Browsers may send "HH:MM:SS".
  const hm = (input.time ?? "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hm)) v.errors.time = "Pick a time";
  const bad = v.result();
  if (bad) return bad;
  return { ok: true, data: { id: newId() }, message: "Revisit sent to Operations." };
}

export async function cancelRequest(_id: string): Promise<ActionResult> {
  await pause();
  return { ok: true, message: "Request withdrawn." };
}

/* ---------- Complaints ---------- */

export type ComplaintInput = {
  siteId: string;
  visitId?: string;
  category: string;
  description: string;
  priority: string;
  files?: unknown;
};

export async function lodgeComplaint(input: ComplaintInput): Promise<ActionResult<{ id: string }>> {
  await pause();
  const v = validator();
  v.uuid("siteId", input.siteId, "the branch / site");
  v.uuid("visitId", input.visitId, "the related job", false);
  v.oneOf("category", input.category, CATEGORIES, "the category");
  v.text("description", input.description, { label: "Description", required: true, min: 10, max: 4000 });
  v.oneOf("priority", input.priority, PRIORITIES, "the priority");
  v.files("files", input.files, USER);
  const bad = v.result();
  if (bad) return bad;
  return { ok: true, data: { id: newId() }, message: "Complaint sent to Admin / Operations." };
}

export async function commentComplaint(_id: string, message: string): Promise<ActionResult> {
  await pause();
  const v = validator();
  v.text("message", message, { label: "Message", required: true, max: 4000 });
  const bad = v.result();
  if (bad) return bad;
  return { ok: true, message: "Note added." };
}

/* ---------- Site inspections (visits + findings) ---------- */

export type SiteVisitInput = {
  siteId: string;
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

/** One visit: re-check earlier findings (fixed / not fixed), add new findings, notes and photos. */
export async function recordSiteVisit(input: SiteVisitInput): Promise<ActionResult<{ id: string }>> {
  await pause();
  const v = validator();
  v.uuid("siteId", input.siteId, "the branch / site");
  const date = v.date("visitDate", input.visitDate, { label: "Visit date", required: true });
  if (date && date > todayYmd()) v.errors.visitDate = "The visit date cannot be in the future";
  v.oneOf("pestActivity", input.pestActivity, ["none", "low", "medium", "high"] as const, "pest activity level", false);
  const notes = v.text("notes", input.notes, { label: "Notes", max: 4000 });
  v.files("files", input.files, USER);

  const checks = (Array.isArray(input.checks) ? input.checks : []).map((c, i) => ({
    finding_id: v.uuid(`check${i}`, c?.findingId, "the finding"),
    result: v.oneOf(`check${i}`, c?.result, ["fixed", "not_fixed"] as const, "fixed or not fixed"),
    note: v.text(`checkNote${i}`, c?.note, { label: "Note", max: 2000 }),
  }));
  const raw = Array.isArray(input.findings) ? input.findings : [];
  if (raw.length > 20) v.errors.findings = "Add at most 20 new findings per visit";
  const findings = raw.slice(0, 20).map((f, i) => {
    v.oneOf(`category${i}`, f?.category, ["structural", "hygiene", "housekeeping", "pest_activity", "waste", "other"] as const, "the category");
    v.text(`department${i}`, f?.department, { label: "Department", max: 200 });
    v.text(`area${i}`, f?.area, { label: "Location", max: 200 });
    v.text(`finding${i}`, f?.description, { label: "Observation", required: true, min: 5, max: 2000 });
    v.text(`risk${i}`, f?.risk, { label: "Risk", max: 1000 });
    v.text(`recommendation${i}`, f?.recommendation, { label: "Recommendation", max: 1000 });
    v.oneOf(`severity${i}`, f?.severity, PRIORITIES, "the gap classification");
    v.oneOf(`responsibility${i}`, f?.responsibility, ["client", "ikpm", "shared"] as const, "who is responsible", false);
    v.files(`findingFiles${i}`, f?.files, USER);
    return f;
  });
  if (!notes && !checks.length && !findings.length) v.errors.notes = "Add a finding, check an earlier finding, or write a visit note";
  const bad = v.result();
  if (bad) return bad;

  const fixed = checks.filter((c) => c.result === "fixed").length;
  return {
    ok: true, data: { id: newId() },
    message: `Visit saved${findings.length ? ` · ${findings.length} new finding${findings.length > 1 ? "s" : ""}` : ""}${fixed ? ` · ${fixed} fixed` : ""}.`,
  };
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
  return {
    ok: true,
    message: rsvp === "confirmed" ? "Attendance confirmed." : rsvp === "declined" ? "Meeting declined." : att ? "Attendance marked." : "Notes saved.",
  };
}

/* ---------- Notifications ---------- */

export async function markNotificationsRead(_ids?: string[]): Promise<ActionResult> {
  return { ok: true };
}
