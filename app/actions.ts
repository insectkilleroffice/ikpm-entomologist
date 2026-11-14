"use server";

/**
 * Every change this portal makes. Each action:
 *   1. checks the session and the entomologist role on the server,
 *   2. validates the input,
 *   3. calls a SECURITY DEFINER function in schema "ento", which checks again
 *      (assignment, site authorization, status) and writes the audit trail.
 * The browser never writes tables directly, and no service-role key is used.
 */
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, validator } from "@/lib/validate";
import { todayYmd } from "@/lib/time";
import type { ActionResult } from "@/lib/types";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = [
  "poor_treatment_quality", "pest_activity_present", "client_dissatisfaction",
  "pco_performance", "chemical_safety", "site_hygiene", "report_quality", "other",
] as const;

async function entomologist() {
  const { supabase, me } = await getSession();
  if (!me) return { error: { ok: false, error: "Your session has expired. Sign in again." } as const };
  if (me.role !== "entomologist") return { error: { ok: false, error: "Only entomologists can do this." } as const };
  return { supabase, db: supabase.schema("ento"), me };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

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
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const v = validator();
  const id = v.uuid("assignmentId", input.assignmentId, "the job");
  const decision = v.oneOf("decision", input.decision, ["verified", "rejected"] as const, "Verify or Reject");
  const remarks = v.text("remarks", input.remarks, { label: "Remarks", max: 2000 });
  const reason = v.text("reason", input.reason, {
    label: "Reason for rejection", required: decision === "rejected", min: decision === "rejected" ? 10 : 0, max: 2000,
  });
  const pest = v.oneOf("pestActivity", input.pestActivity, ["none", "low", "medium", "high"] as const, "pest activity level", false);
  const files = v.files("files", input.files, s.me.id);
  const bad = v.result();
  if (bad) return bad;

  const c = input.checks ?? {};
  const { error } = await s.db.rpc("decide_job", {
    p_assignment_id: id,
    p_decision: decision,
    p_remarks: remarks,
    p_reason: decision === "rejected" ? reason : null,
    p_checks: { treatment: !!c.treatment, chemicals: !!c.chemicals, photos: !!c.photos, report: !!c.report },
    p_pest_activity: pest,
    p_files: files,
  });
  if (error) return dbError(error);
  refresh();
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
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const v = validator();
  const type = v.oneOf("type", input.type, ["revisit", "inspection"] as const, "the request type");
  const siteId = v.uuid("siteId", input.siteId, "the branch / site");
  const visitId = v.uuid("visitId", input.visitId, "the previous job", type === "revisit");
  const reason = type === "revisit" ? v.text("reason", input.reason, { label: "Reason for revisit", required: true, max: 500 }) : null;
  const purpose = type === "inspection" ? v.text("purpose", input.purpose, { label: "Inspection purpose", required: true, max: 500 }) : null;
  const description = v.text("description", input.description, {
    label: type === "inspection" ? "Observations" : "Pest activity / problem", required: true, min: 10, max: 4000,
  });
  const priority = v.oneOf("priority", input.priority, PRIORITIES, "the priority");
  const date = v.date("recommendedDate", input.recommendedDate, { label: "Recommended date", required: true, min: todayYmd() });
  const files = v.files("files", input.files, s.me.id);
  const bad = v.result();
  if (bad) return bad;

  const { data, error } = await s.db.rpc("submit_request", {
    p_type: type, p_site_id: siteId, p_visit_id: visitId, p_reason: reason, p_purpose: purpose,
    p_description: description, p_priority: priority, p_recommended_date: date, p_files: files,
  });
  if (error) return dbError(error);
  refresh();
  return { ok: true, data: { id: data as string }, message: "Request sent to Admin for approval." };
}

/** Revisit straight to Operations (no admin approval): creates the ops revisit visit. */
export async function sendRevisit(input: { visitId: string; reason: string; description: string; date: string; time: string }): Promise<ActionResult<{ id: string }>> {
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const v = validator();
  const visitId = v.uuid("visitId", input.visitId, "the job");
  const reason = v.text("reason", input.reason, { label: "Reason for revisit", required: true, max: 500 });
  const description = v.text("description", input.description, { label: "Problem", required: true, min: 10, max: 4000 });
  const date = v.date("date", input.date, { label: "Date", required: true, min: todayYmd() });
  // Browsers may send "HH:MM:SS"; Operations stores "HH:MM".
  const hm = (input.time ?? "").slice(0, 5);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(hm) ? hm : null;
  if (!time) v.errors.time = "Pick a time";
  const bad = v.result();
  if (bad) return bad;
  const { data, error } = await s.db.rpc("send_revisit", { p_visit_id: visitId, p_reason: reason, p_description: description, p_date: date, p_time: time });
  if (error) return dbError(error);
  refresh();
  return { ok: true, data: { id: data as string }, message: "Revisit sent to Operations." };
}

export async function cancelRequest(id: string): Promise<ActionResult> {
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const v = validator();
  const rid = v.uuid("id", id, "the request");
  const bad = v.result();
  if (bad) return bad;
  const { error } = await s.db.rpc("cancel_request", { p_id: rid, p_note: null });
  if (error) return dbError(error);
  refresh();
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
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const v = validator();
  const siteId = v.uuid("siteId", input.siteId, "the branch / site");
  const visitId = v.uuid("visitId", input.visitId, "the related job", false);
  const category = v.oneOf("category", input.category, CATEGORIES, "the category");
  const description = v.text("description", input.description, { label: "Description", required: true, min: 10, max: 4000 });
  const priority = v.oneOf("priority", input.priority, PRIORITIES, "the priority");
  const files = v.files("files", input.files, s.me.id);
  const bad = v.result();
  if (bad) return bad;

  const { data, error } = await s.db.rpc("lodge_complaint", {
    p_site_id: siteId, p_visit_id: visitId, p_category: category, p_description: description,
    p_priority: priority, p_files: files,
  });
  if (error) return dbError(error);
  refresh();
  return { ok: true, data: { id: data as string }, message: "Complaint sent to Admin / Operations." };
}

export async function commentComplaint(id: string, message: string): Promise<ActionResult> {
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const v = validator();
  const cid = v.uuid("id", id, "the complaint");
  const text = v.text("message", message, { label: "Message", required: true, max: 4000 });
  const bad = v.result();
  if (bad) return bad;
  const { error } = await s.db.rpc("comment_complaint", { p_id: cid, p_message: text });
  if (error) return dbError(error);
  refresh();
  return { ok: true, message: "Note added." };
}

/* ---------- Meetings ---------- */

export type MeetingResponseInput = {
  meetingId: string;
  rsvp?: "confirmed" | "declined";
  attendance?: "attended" | "absent";
  notes?: string;
};

export async function respondMeeting(input: MeetingResponseInput): Promise<ActionResult> {
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const v = validator();
  const id = v.uuid("meetingId", input.meetingId, "the meeting");
  const rsvp = v.oneOf("rsvp", input.rsvp, ["confirmed", "declined"] as const, "confirm or decline", false);
  const att = v.oneOf("attendance", input.attendance, ["attended", "absent"] as const, "attendance", false);
  const notes = input.notes === undefined ? null : (v.text("notes", input.notes, { label: "Notes", max: 4000 }) ?? "");
  const bad = v.result();
  if (bad) return bad;
  if (!rsvp && !att && notes === null) return { ok: false, error: "Nothing to save." };

  const { error } = await s.db.rpc("respond_meeting", {
    p_meeting_id: id, p_rsvp: rsvp, p_attendance: att, p_notes: notes,
  });
  if (error) return dbError(error);
  refresh();
  return {
    ok: true,
    message: rsvp === "confirmed" ? "Attendance confirmed." : rsvp === "declined" ? "Meeting declined." : att ? "Attendance marked." : "Notes saved.",
  };
}

/* ---------- Notifications ---------- */

export async function markNotificationsRead(ids?: string[]): Promise<ActionResult> {
  const s = await entomologist();
  if ("error" in s) return s.error!;
  const list = ids?.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const { error } = await s.db.rpc("mark_notifications_read", { p_ids: list && list.length ? list : null });
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}
