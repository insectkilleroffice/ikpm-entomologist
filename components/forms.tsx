"use client";

/**
 * The portal's forms, used inside the planner's slide-in drawer:
 *   - Verify a job (optional note)
 *   - Mark a job as a complaint (service issue / document issue, reason required)
 *   - Submit an assigned inspection's report (saveSiteVisit, used by the gap report)
 *   - Add a note to a complaint, answer a meeting
 * Validation runs here for quick feedback and again in the action.
 */
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { uploadFiles, removeUploads } from "@/lib/upload";
import { commentComplaint, markJobComplaint, respondMeeting, submitInspectionReport, verifyJob } from "@/app/actions";
import { COMPLAINT_ISSUE } from "@/lib/labels";
import type { ActionResult } from "@/lib/types";

function Field({ label, error, children, hint, htmlFor, req }: {
  label: string; error?: string; children: ReactNode; hint?: string; htmlFor?: string; req?: boolean;
}) {
  return (
    <div className="fld">
      <label htmlFor={htmlFor}>
        {label}
        {req && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <small>{hint}</small>}
      {error && <span className="ferr" role="alert">{error}</span>}
    </div>
  );
}

function Feedback({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p className="err" role="alert">{error}</p>;
  if (ok) return <p className="msg" role="status">{ok}</p>;
  return null;
}

/* ---------------------------------------------------------------------------
   Verify a job: an optional note and the Verify button
   --------------------------------------------------------------------------- */
export function VerifyForm({ assignmentId, onDone }: { assignmentId: string; onDone?: (msg: string) => void }) {
  const id = useId();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const verify = () => start(async () => {
    setError(null);
    const r = await verifyJob({ assignmentId, note });
    if (!r.ok) return setError(r.error);
    onDone?.(r.message ?? "Job verified.");
  });

  return (
    <div className="form">
      <Field label="Note (optional)" htmlFor={id}>
        <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
          placeholder="e.g. Good coverage, photos clear." />
      </Field>
      <Feedback error={error} />
      <div className="row">
        <button type="button" className="btn sm" disabled={pending} onClick={verify}>{pending ? "Saving…" : "Verify"}</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Mark a job as a complaint: service issue or document issue, with the reason
   --------------------------------------------------------------------------- */
export function JobComplaintForm({ assignmentId, onDone }: { assignmentId: string; onDone?: (msg: string) => void }) {
  const id = useId();
  const [issue, setIssue] = useState<"" | "service" | "document">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    const e: Record<string, string> = {};
    if (!issue) e.issue = "Choose service issue or document issue";
    if (reason.trim().length < 10) e.reason = "Write the reason (at least 10 characters)";
    setErrors(e);
    if (Object.keys(e).length) return setError("Please fix the highlighted fields.");
    setError(null);
    start(async () => {
      const r = await markJobComplaint({ assignmentId, issue, reason });
      if (!r.ok) {
        setErrors(r.fields ?? {});
        return setError(r.error);
      }
      onDone?.(r.message ?? "Complaint sent to Operations.");
    });
  };

  return (
    <div className="form">
      <div className="fld">
        <span className="lb">What is wrong with this service?<span className="req" aria-hidden="true">*</span></span>
        <div className="seg" role="group" aria-label="Complaint type">
          {(["service", "document"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={issue === k} onClick={() => setIssue(k)}>{COMPLAINT_ISSUE[k].label}</button>
          ))}
        </div>
        {issue && <small>{COMPLAINT_ISSUE[issue].action}</small>}
        {errors.issue && <span className="ferr" role="alert">{errors.issue}</span>}
      </div>
      <Field label="Reason" htmlFor={id} error={errors.reason} req>
        <textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000}
          placeholder={issue === "document"
            ? "e.g. Challan photo is blurry; store-area pictures are missing."
            : "e.g. Cockroach activity still present in the kitchen after the service."} />
      </Field>
      <Feedback error={error} />
      <div className="row">
        <button type="button" className="btn red sm" disabled={pending} onClick={submit}>{pending ? "Sending…" : "Mark as complaint"}</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Inspection report (filled in on the gap report): upload photos, then submit
   --------------------------------------------------------------------------- */
export type DraftFinding = {
  key: number; category: string; department: string; area: string; description: string; risk: string;
  recommendation: string; severity: string; responsibility: string; files: File[];
};
export type DraftCheck = { result: "" | "fixed" | "not_fixed"; note: string };

/** Uploads the report's and each new finding's photos, then submits the report; removes the uploads if it fails. */
export async function saveSiteVisit(userId: string, v: {
  inspectionId: string; date: string; pest: string; notes: string; files: File[];
  checks: Record<string, DraftCheck>; findings: DraftFinding[];
}): Promise<ActionResult<{ id: string }>> {
  const uploaded: string[] = [];
  try {
    const up = await uploadFiles(userId, "site-visits", v.files);
    uploaded.push(...up.map((u) => u.path));
    const findings = [];
    for (const f of v.findings) {
      const fu = await uploadFiles(userId, "findings", f.files);
      uploaded.push(...fu.map((u) => u.path));
      findings.push({
        category: f.category, department: f.department, area: f.area, description: f.description, risk: f.risk,
        recommendation: f.recommendation, severity: f.severity, responsibility: f.responsibility || undefined, files: fu,
      });
    }
    const r = await submitInspectionReport({
      inspectionId: v.inspectionId, visitDate: v.date, pestActivity: v.pest || undefined, notes: v.notes, files: up, findings,
      checks: Object.entries(v.checks).filter(([, c]) => c.result)
        .map(([findingId, c]) => ({ findingId, result: c.result as "fixed" | "not_fixed", note: c.note })),
    });
    if (!r.ok) await removeUploads(uploaded);
    return r;
  } catch (e) {
    await removeUploads(uploaded);
    return { ok: false, error: `Could not save: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/* ---------------------------------------------------------------------------
   Small forms
   --------------------------------------------------------------------------- */
export function CommentForm({ complaintId, onDone }: { complaintId: string; onDone?: () => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="form">
      <Field label="Add a note for Operations" htmlFor={id}>
        <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      </Field>
      {msg && <Feedback ok={msg.ok ? msg.text : null} error={msg.ok ? null : msg.text} />}
      <div className="row">
        <button type="button" className="btn sm" disabled={pending || !text.trim()}
          onClick={() => start(async () => {
            const r = await commentComplaint(complaintId, text);
            setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : r.error });
            if (r.ok) {
              setText("");
              onDone?.();
            }
          })}>
          {pending ? "Saving…" : "Add note"}
        </button>
      </div>
    </div>
  );
}

/** Confirm / decline, mark attendance and keep notes for a meeting. */
export function MeetingResponse({ meetingId, rsvp, attendance, notes, startsAt, cancelled }: {
  meetingId: string; rsvp: string; attendance: string; notes: string | null; startsAt: string; cancelled: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(notes ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Attendance opens 30 minutes before the start (the database enforces the same rule).
  const [canMark, setCanMark] = useState(false);
  useEffect(() => {
    const t = new Date(startsAt).getTime() - 30 * 60 * 1000;
    const tick = () => setCanMark(Date.now() >= t);
    tick();
    const h = setInterval(tick, 30_000);
    return () => clearInterval(h);
  }, [startsAt]);

  const send = (input: Parameters<typeof respondMeeting>[0]) =>
    start(async () => {
      const r = await respondMeeting(input);
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : r.error });
    });

  if (cancelled) return <p className="note">This meeting was cancelled.</p>;

  return (
    <div className="form">
      <div className="fld">
        <span className="lb">Your attendance</span>
        <div className="row">
          <button type="button" className={`btn sm${rsvp === "confirmed" ? "" : " alt"}`} disabled={pending} aria-pressed={rsvp === "confirmed"}
            onClick={() => send({ meetingId, rsvp: "confirmed" })}>Confirm</button>
          <button type="button" className="btn alt sm" disabled={pending} aria-pressed={rsvp === "declined"}
            onClick={() => send({ meetingId, rsvp: "declined" })}>Decline</button>
        </div>
      </div>
      <div className="fld">
        <span className="lb">Mark attendance</span>
        <div className="row">
          <button type="button" className={`btn sm${attendance === "attended" ? "" : " alt"}`} disabled={pending || !canMark} aria-pressed={attendance === "attended"}
            onClick={() => send({ meetingId, attendance: "attended" })}>Attended</button>
          <button type="button" className="btn alt sm" disabled={pending || !canMark} aria-pressed={attendance === "absent"}
            onClick={() => send({ meetingId, attendance: "absent" })}>Absent</button>
        </div>
        {!canMark && <small>Available from 30 minutes before the meeting starts.</small>}
      </div>
      <Field label="Your notes" htmlFor={id}>
        <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Discussion points, action items…" />
      </Field>
      {msg && <Feedback ok={msg.ok ? msg.text : null} error={msg.ok ? null : msg.text} />}
      <div className="row">
        <button type="button" className="btn alt sm" disabled={pending || text === (notes ?? "")}
          onClick={() => send({ meetingId, notes: text })}>
          {pending ? "Saving…" : "Save notes"}
        </button>
      </div>
    </div>
  );
}
