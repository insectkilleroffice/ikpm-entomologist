"use client";

/**
 * The portal's forms. Each is used both on its own page and inside the calendar's
 * detail drawer (pre-linked to the job / site there), so there is one implementation
 * per action. Validation runs here for quick feedback and again on the server.
 */
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { ento } from "@/lib/client-data";
import { uploadFiles, removeUploads } from "@/lib/upload";
import { cancelRequest, commentComplaint, decideJob, lodgeComplaint, recordSiteVisit, respondMeeting, sendRevisit, submitRequest } from "@/app/actions";
import { COMPLAINT_CATEGORY, PRIORITY } from "@/lib/labels";
import { addDays, fmtDate, todayYmd } from "@/lib/time";
import type { ActionResult, SiteRow } from "@/lib/types";
import { PhotoPicker } from "./PhotoPicker";

type Errors = Record<string, string>;

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

/** Runs upload + server action; removes the uploads again if saving fails. */
function useSubmit() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [ok, setOk] = useState<string | null>(null);

  function run<T>(opts: {
    userId: string; folder: string; files: File[];
    validate?: () => Errors;
    send: (files: Awaited<ReturnType<typeof uploadFiles>>) => Promise<ActionResult<T>>;
    done?: (r: Extract<ActionResult<T>, { ok: true }>) => void;
  }) {
    setError(null);
    setOk(null);
    const pre = opts.validate?.() ?? {};
    setErrors(pre);
    if (Object.keys(pre).length) return setError("Please fix the highlighted fields.");
    start(async () => {
      let uploaded: Awaited<ReturnType<typeof uploadFiles>> = [];
      try {
        uploaded = await uploadFiles(opts.userId, opts.folder, opts.files);
      } catch (e) {
        setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      const r = await opts.send(uploaded).catch((e): ActionResult<T> => ({ ok: false, error: e instanceof Error ? e.message : "Could not reach the server" }));
      if (!r.ok) {
        await removeUploads(uploaded.map((u) => u.path));
        setErrors(r.fields ?? {});
        setError(r.error);
        return;
      }
      setOk(r.message ?? "Saved.");
      opts.done?.(r);
    });
  }
  return { pending, error, errors, ok, run, setOk };
}

/** Previous jobs at a site, for the "related / previous job" selects (read with the user's row security). */
function useSiteJobs(siteId: string | undefined) {
  const [jobs, setJobs] = useState<{ visit_id: string; job_code: string | null; visit_date: string; kind: string }[]>([]);
  useEffect(() => {
    let live = true;
    if (!siteId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear when no site is chosen
      setJobs([]);
      return;
    }
    ento().from("v_jobs").select("visit_id,job_code,visit_date,kind")
      .eq("site_id", siteId).not("verification_status", "is", null).lte("visit_date", todayYmd()).order("visit_date", { ascending: false }).limit(60)
      .then(({ data }) => live && setJobs(data ?? []));
    return () => {
      live = false;
    };
  }, [siteId]);
  return jobs;
}

/* ---------------------------------------------------------------------------
   Verify a job: a note and the Verify button
   --------------------------------------------------------------------------- */
export function VerifyForm({ assignmentId, siteId, visitId, onDone }: {
  assignmentId: string; siteId: string; visitId: string; onDone?: (msg: string) => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [kind, setKind] = useState<"report_quality" | "pco_performance" | "other">("report_quality");

  const verify = () => start(async () => {
    setError(null);
    const r = await decideJob({ assignmentId, decision: "verified", remarks: note });
    if (!r.ok) return setError(r.error);
    setDone(r.message ?? "Job verified.");
    onDone?.(r.message ?? "");
  });
  const askComplaint = () => {
    setMsg(null);
    if (note.trim().length < 10) return setError("Write the note first (at least 10 characters). It is sent to Admin as the complaint.");
    setError(null);
    setConfirming(true);
  };
  const sendComplaint = () => start(async () => {
    const r = await lodgeComplaint({ siteId, visitId, category: kind, description: note, priority: "medium" });
    if (!r.ok) return setError(r.error);
    setConfirming(false);
    setNote("");
    setMsg("Complaint sent to Admin. The job is still waiting for verification.");
    onDone?.("");
  });

  if (done) return <Feedback ok={done} />;
  return (
    <div className="form">
      <Field label="Note" htmlFor={id}>
        <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
          placeholder="Optional for Verify. Required for a complaint (e.g. challan photo is blurry)." />
      </Field>
      <Feedback error={error} ok={msg} />
      {confirming ? (
        <div className="fld" role="group" aria-label="Confirm complaint">
          <span className="lb">Send this note to Admin as a complaint about this job?</span>
          <div className="seg" role="group" aria-label="Complaint type">
            {([["report_quality", "Unclear photos / report"], ["pco_performance", "PCO issue"], ["other", "Other"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn red sm" disabled={pending} onClick={sendComplaint}>{pending ? "Sending…" : "Yes, send to Admin"}</button>
            <button type="button" className="btn alt sm" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn sm" disabled={pending} onClick={verify}>{pending ? "Saving…" : "Verify"}</button>
          <button type="button" className="btn alt sm" disabled={pending} onClick={askComplaint}>Lodge complaint</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Revisit: goes straight to Operations (no admin approval)
   --------------------------------------------------------------------------- */
export function RevisitForm({ sites, fixed, preset, onDone }: {
  sites: SiteRow[]; fixed?: FixedLink; preset?: { siteId?: string }; onDone?: (id: string, msg: string) => void;
}) {
  const id = useId();
  const [clientId, setClientId] = useState(() => sites.find((s) => s.site_id === (fixed?.siteId ?? preset?.siteId))?.client_id ?? "");
  const [siteId, setSiteId] = useState(fixed?.siteId ?? preset?.siteId ?? "");
  const [visitId, setVisitId] = useState(fixed?.visitId ?? "");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(addDays(todayYmd(), 1));
  const [time, setTime] = useState("10:00");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const jobs = useSiteJobs(fixed ? undefined : siteId);
  const clients = [...new Map(sites.map((x) => [x.client_id, x.client_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const submit = () => {
    const e: Errors = {};
    if (!visitId) e.visitId = "Choose the job to revisit";
    if (!reason.trim()) e.reason = "Write the reason for the revisit";
    if (description.trim().length < 10) e.description = "At least 10 characters";
    if (!date || date < todayYmd()) e.date = "Pick today or a later date";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.slice(0, 5))) e.time = "Pick a time";
    setErrors(e);
    setError(Object.keys(e).length ? "Please fix the highlighted fields." : null);
    if (Object.keys(e).length) return;
    start(async () => {
      const r = await sendRevisit({ visitId, reason, description, date, time: time.slice(0, 5) });
      if (!r.ok) {
        setErrors(r.fields ?? {});
        return setError(r.error);
      }
      setOk(r.message ?? "Revisit sent to Operations.");
      onDone?.(r.data!.id, r.message ?? "");
    });
  };

  if (ok) return <Feedback ok={ok} />;
  return (
    <div className="form">
      {!fixed && (
        <>
          <div className="grid">
            <Field label="Client" htmlFor={`${id}-c`} req>
              <select id={`${id}-c`} value={clientId} onChange={(e) => { setClientId(e.target.value); setSiteId(""); setVisitId(""); }}>
                <option value="">Choose client</option>
                {clients.map(([cid, n]) => <option key={cid} value={cid}>{n}</option>)}
              </select>
            </Field>
            <Field label="Branch / site" htmlFor={`${id}-s`} req>
              <select id={`${id}-s`} value={siteId} disabled={!clientId} onChange={(e) => { setSiteId(e.target.value); setVisitId(""); }}>
                <option value="">{clientId ? "Choose branch" : "Choose client first"}</option>
                {sites.filter((x) => x.client_id === clientId).map((x) => (
                  <option key={x.site_id} value={x.site_id}>{x.site_name}{x.city ? ` · ${x.city}` : ""}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Job" htmlFor={`${id}-j`} error={errors.visitId} req>
            <select id={`${id}-j`} value={visitId} disabled={!siteId} onChange={(e) => setVisitId(e.target.value)}>
              <option value="">{siteId ? (jobs.length ? "Choose job" : "No jobs at this site") : "Choose branch first"}</option>
              {jobs.map((j) => <option key={j.visit_id} value={j.visit_id}>{j.job_code ?? "Job"} · {fmtDate(j.visit_date)}</option>)}
            </select>
          </Field>
        </>
      )}
      <Field label="Reason for revisit" htmlFor={`${id}-r`} error={errors.reason} req>
        <input id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Cockroach activity persists in kitchen" />
      </Field>
      <Field label="Pest activity / problem" htmlFor={`${id}-d`} error={errors.description} req>
        <textarea id={`${id}-d`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
      </Field>
      <div className="grid">
        <Field label="Date" htmlFor={`${id}-dt`} error={errors.date} req>
          <input id={`${id}-dt`} type="date" min={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time" htmlFor={`${id}-tm`} error={errors.time} req>
          <input id={`${id}-tm`} type="time" value={time} onChange={(e) => setTime(e.target.value.slice(0, 5))} />
        </Field>
      </div>
      <Feedback error={error} />
      <div className="row">
        <button type="button" className="btn sm" disabled={pending} onClick={submit}>
          {pending ? "Sending…" : "Send to Operations"}
        </button>
      </div>
      <p className="note">Goes straight to Operations. The site&rsquo;s operations manager assigns the PCO.</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Revisit / inspection request
   --------------------------------------------------------------------------- */
export type FixedLink = { siteId: string; visitId?: string; label: string };

export function RequestForm({ userId, sites, type: initialType, fixed, preset, onDone }: {
  userId: string; sites: SiteRow[]; type?: "revisit" | "inspection"; fixed?: FixedLink; preset?: { siteId?: string; visitId?: string };
  onDone?: (id: string, msg: string) => void;
}) {
  const id = useId();
  const type = initialType ?? "inspection";
  const [clientId, setClientId] = useState(() => sites.find((s) => s.site_id === (fixed?.siteId ?? preset?.siteId))?.client_id ?? "");
  const [siteId, setSiteId] = useState(fixed?.siteId ?? preset?.siteId ?? "");
  const [visitId, setVisitId] = useState(fixed?.visitId ?? preset?.visitId ?? "");
  const [reason, setReason] = useState("");
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [date, setDate] = useState(addDays(todayYmd(), 2));
  const [files, setFiles] = useState<File[]>([]);
  const jobs = useSiteJobs(fixed ? undefined : siteId);
  const s = useSubmit();
  const clients = [...new Map(sites.map((x) => [x.client_id, x.client_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const branchList = sites.filter((x) => x.client_id === clientId);

  const submit = () =>
    s.run({
      userId, folder: "requests", files,
      validate: () => {
        const e: Errors = {};
        if (!siteId) e.siteId = "Choose the branch / site";
        if (type === "revisit" && !visitId) e.visitId = "Choose the previous job";
        if (type === "revisit" && !reason.trim()) e.reason = "Write the reason for the revisit";
        if (type === "inspection" && !purpose.trim()) e.purpose = "Write the inspection purpose";
        if (description.trim().length < 10) e.description = "At least 10 characters";
        if (!date || date < todayYmd()) e.recommendedDate = "Pick today or a later date";
        return e;
      },
      send: (up) => submitRequest({ type, siteId, visitId: visitId || undefined, reason, purpose, description, priority, recommendedDate: date, files: up }),
      done: (r) => onDone?.(r.data!.id, r.message ?? ""),
    });

  if (s.ok && onDone) return <Feedback ok={s.ok} />;

  return (
    <div className="form">
      {fixed ? (
        <Field label="Linked to" htmlFor={`${id}-fx`}>
          <input id={`${id}-fx`} readOnly value={fixed.label} />
        </Field>
      ) : (
        <div className="grid">
          <Field label="Client" htmlFor={`${id}-c`} req>
            <select id={`${id}-c`} value={clientId} onChange={(e) => { setClientId(e.target.value); setSiteId(""); setVisitId(""); }}>
              <option value="">Choose client</option>
              {clients.map(([cid, n]) => <option key={cid} value={cid}>{n}</option>)}
            </select>
          </Field>
          <Field label="Branch / site" htmlFor={`${id}-s`} error={s.errors.siteId} req>
            <select id={`${id}-s`} value={siteId} disabled={!clientId} onChange={(e) => { setSiteId(e.target.value); setVisitId(""); }}>
              <option value="">{clientId ? "Choose branch" : "Choose client first"}</option>
              {branchList.map((x) => <option key={x.site_id} value={x.site_id}>{x.site_name}{x.city ? ` · ${x.city}` : ""}</option>)}
            </select>
          </Field>
        </div>
      )}
      {!fixed && (type === "revisit" || siteId) && (
        <Field label={type === "revisit" ? "Previous job" : "Related job (optional)"} htmlFor={`${id}-j`} error={s.errors.visitId} req={type === "revisit"}>
          <select id={`${id}-j`} value={visitId} disabled={!siteId} onChange={(e) => setVisitId(e.target.value)}>
            <option value="">{siteId ? (jobs.length ? "Choose job" : "No previous jobs at this site") : "Choose branch first"}</option>
            {jobs.map((j) => <option key={j.visit_id} value={j.visit_id}>{j.job_code ?? "Job"} · {fmtDate(j.visit_date)}</option>)}
          </select>
        </Field>
      )}
      {type === "revisit" ? (
        <Field label="Reason for revisit" htmlFor={`${id}-r`} error={s.errors.reason} req>
          <input id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Cockroach activity persists in kitchen" />
        </Field>
      ) : (
        <Field label="Inspection purpose" htmlFor={`${id}-u`} error={s.errors.purpose} req>
          <input id={`${id}-u`} value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} placeholder="e.g. Quarterly rodent risk assessment" />
        </Field>
      )}
      <Field label={type === "revisit" ? "Pest activity / problem description" : "Observations"} htmlFor={`${id}-d`} error={s.errors.description} req>
        <textarea id={`${id}-d`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
      </Field>
      <div className="grid">
        <Field label="Priority" htmlFor={`${id}-p`} req>
          <select id={`${id}-p`} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Recommended date" htmlFor={`${id}-dt`} error={s.errors.recommendedDate} req>
          <input id={`${id}-dt`} type="date" min={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <PhotoPicker files={files} onChange={setFiles} label="Supporting photos" />
      <Feedback error={s.error} ok={s.ok} />
      <div className="row">
        <button type="button" className="btn sm" disabled={s.pending} onClick={submit}>
          {s.pending ? "Sending…" : "Send to Admin"}
        </button>
      </div>
      <p className="note">Admin approves or rejects, then schedules the date and assigns the PCO. You can track it under Requests.</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Complaint
   --------------------------------------------------------------------------- */
export function ComplaintForm({ userId, sites, fixed, preset, onDone }: {
  userId: string; sites: SiteRow[]; fixed?: FixedLink; preset?: { siteId?: string; visitId?: string };
  onDone?: (id: string, msg: string) => void;
}) {
  const id = useId();
  const [clientId, setClientId] = useState(() => sites.find((s) => s.site_id === (fixed?.siteId ?? preset?.siteId))?.client_id ?? "");
  const [siteId, setSiteId] = useState(fixed?.siteId ?? preset?.siteId ?? "");
  const [visitId, setVisitId] = useState(fixed?.visitId ?? preset?.visitId ?? "");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [files, setFiles] = useState<File[]>([]);
  const jobs = useSiteJobs(fixed ? undefined : siteId);
  const s = useSubmit();
  const clients = [...new Map(sites.map((x) => [x.client_id, x.client_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const submit = () =>
    s.run({
      userId, folder: "complaints", files,
      validate: () => {
        const e: Errors = {};
        if (!siteId) e.siteId = "Choose the branch / site";
        if (!category) e.category = "Choose the category";
        if (description.trim().length < 10) e.description = "At least 10 characters";
        return e;
      },
      send: (up) => lodgeComplaint({ siteId, visitId: visitId || undefined, category, description, priority, files: up }),
      done: (r) => onDone?.(r.data!.id, r.message ?? ""),
    });

  if (s.ok && onDone) return <Feedback ok={s.ok} />;

  return (
    <div className="form">
      <h3>Lodge complaint</h3>
      {fixed ? (
        <Field label="Linked to" htmlFor={`${id}-fx`}>
          <input id={`${id}-fx`} readOnly value={fixed.label} />
        </Field>
      ) : (
        <>
          <div className="grid">
            <Field label="Client" htmlFor={`${id}-c`} req>
              <select id={`${id}-c`} value={clientId} onChange={(e) => { setClientId(e.target.value); setSiteId(""); setVisitId(""); }}>
                <option value="">Choose client</option>
                {clients.map(([cid, n]) => <option key={cid} value={cid}>{n}</option>)}
              </select>
            </Field>
            <Field label="Branch / site" htmlFor={`${id}-s`} error={s.errors.siteId} req>
              <select id={`${id}-s`} value={siteId} disabled={!clientId} onChange={(e) => { setSiteId(e.target.value); setVisitId(""); }}>
                <option value="">{clientId ? "Choose branch" : "Choose client first"}</option>
                {sites.filter((x) => x.client_id === clientId).map((x) => (
                  <option key={x.site_id} value={x.site_id}>{x.site_name}{x.city ? ` · ${x.city}` : ""}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Related job (optional)" htmlFor={`${id}-j`}>
            <select id={`${id}-j`} value={visitId} disabled={!siteId} onChange={(e) => setVisitId(e.target.value)}>
              <option value="">None</option>
              {jobs.map((j) => <option key={j.visit_id} value={j.visit_id}>{j.job_code ?? "Job"} · {fmtDate(j.visit_date)}</option>)}
            </select>
          </Field>
        </>
      )}
      <div className="grid">
        <Field label="Category" htmlFor={`${id}-k`} error={s.errors.category} req>
          <select id={`${id}-k`} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Choose category</option>
            {Object.entries(COMPLAINT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Priority" htmlFor={`${id}-p`} req>
          <select id={`${id}-p`} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" htmlFor={`${id}-d`} error={s.errors.description} req>
        <textarea id={`${id}-d`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000}
          placeholder="What did you find, where, and how serious is it?" />
      </Field>
      <PhotoPicker files={files} onChange={setFiles} label="Photo attachments" />
      <Feedback error={s.error} ok={s.ok} />
      <div className="row">
        <button type="button" className="btn sm" disabled={s.pending} onClick={submit}>
          {s.pending ? "Sending…" : "Send to Admin / Operations"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Site visit (recorded inline in the gap report): upload photos, then save
   --------------------------------------------------------------------------- */
export type DraftFinding = {
  key: number; category: string; department: string; area: string; description: string; risk: string;
  recommendation: string; severity: string; responsibility: string; files: File[];
};
export type DraftCheck = { result: "" | "fixed" | "not_fixed"; note: string };

/** Uploads the visit's and each new finding's photos, then records the visit; removes the uploads if it fails. */
export async function saveSiteVisit(userId: string, v: {
  siteId: string; date: string; pest: string; notes: string; files: File[];
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
    const r = await recordSiteVisit({
      siteId: v.siteId, visitDate: v.date, pestActivity: v.pest || undefined, notes: v.notes, files: up, findings,
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
      <Field label="Add a note for Admin / Operations" htmlFor={id}>
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

export function CancelRequestButton({ id, onDone }: { id: string; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn alt sm" disabled={pending}
        onClick={() => {
          if (!confirm("Withdraw this request? Admin will no longer see it as pending.")) return;
          start(async () => {
            const r = await cancelRequest(id);
            if (!r.ok) setErr(r.error);
            else onDone?.();
          });
        }}>
        {pending ? "Withdrawing…" : "Withdraw request"}
      </button>
      {err && <p className="err" role="alert">{err}</p>}
    </>
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
