"use client";

/**
 * Everything that opens in the planner's slide-in drawer: a job (Report · Verify · Complaint),
 * a complaint and what Operations did about it, an assigned inspection and its report (the gap
 * report form), a meeting, a site report, findings, lists and notifications.
 * The page itself never changes — like the Operations planner.
 */
import { Fragment, useEffect, useId, useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { ento, must, opsDb, useQuery, useSigned } from "@/lib/client-data";
import { markNotificationsRead } from "@/app/actions";
import { CommentForm, JobComplaintForm, MeetingResponse, saveSiteVisit, VerifyForm, type DraftCheck, type DraftFinding } from "./forms";
import { checkFiles } from "@/lib/upload";
import { MAX_FILES } from "@/lib/validate";
import { Photos } from "./Photos";
import {
  ATTENDANCE, CHECK_RESULT, COMPLAINT_FLOW, COMPLAINT_ISSUE, COMPLAINT_OPEN, COMPLAINT_STATUS, FINDING_CATEGORY, FINDING_CATEGORY_ORDER,
  FINDING_STATUS, GAP_CLASS, INSPECTION_STATUS, JOB_KIND, MEETING_STATUS, RESPONSIBILITY,
  OUTCOME, PEST_ACTIVITY, PEST_TONE, RSVP, VERIFICATION, type Tone,
} from "@/lib/labels";
import { dayParts, fmtAgo, fmtDate, fmtDateTime, isoHoursAgo, karachiHm, karachiYmd, todayYmd } from "@/lib/time";
import type {
  AttachmentRow, CheckGridRow, ComplaintRow, ComplaintUpdateRow, FindingCheckRow, FindingRow, InspectionTaskRow, JobRow, MeetingRow,
  NotificationRow, SignedFile, SiteRow, SiteSummaryRow, SiteVisitRow, VerificationRow,
} from "@/lib/types";

/* ---------- panel addresses ---------- */
export type ListKind = "pending" | "verified" | "complaint" | "complaints" | "inspections" | "meetings" | "notifications" | "findings";
export type Panel =
  | { t: "job" | "complaint" | "inspection" | "meeting" | "site" | "visit" | "finding"; id: string }
  /** A branch's gap report; with `task` it is the report form of that assigned inspection. */
  | { t: "gap"; id: string; task?: string }
  | { t: "list"; id: ListKind };

const IDT = ["job", "complaint", "inspection", "meeting", "site", "list", "visit", "finding", "gap"];
/** Panel ↔ "?open=" value, so a refresh or a notification link reopens the same drawer. */
export function encodePanel(p: Panel | undefined): string {
  return p && IDT.includes(p.t) ? `${p.t}_${p.id}` : "";
}
export function decodePanel(s: string | null): Panel | null {
  const m = /^(job|complaint|inspection|meeting|site|list|visit|finding|gap)_([\w-]{3,40})$/.exec(s ?? "");
  return m ? ({ t: m[1], id: m[2] } as Panel) : null;
}
/** Notification links are stored as portal paths ("/jobs/<id>"); map them to panels. */
export function panelFromLink(link: string | null): Panel | null {
  const m = /^\/(jobs|complaints|inspections|meetings|sites)\/([0-9a-f-]{36})$/.exec(link ?? "");
  if (!m) return null;
  const t = ({ jobs: "job", complaints: "complaint", inspections: "inspection", meetings: "meeting", sites: "site" } as const)[m[1] as "jobs"];
  return { t, id: m[2] };
}

export const LIST_TITLE: Record<ListKind, string> = {
  pending: "Pending verification", verified: "Verified jobs", complaint: "Jobs marked as complaint",
  complaints: "Complaints", inspections: "Inspections", meetings: "Meetings", notifications: "Notifications",
  findings: "Site inspections · gap reports",
};
export function defaultTitle(p: Panel): string {
  switch (p.t) {
    case "list": return LIST_TITLE[p.id];
    case "visit": return "Inspection report";
    case "finding": return "Finding";
    case "gap": return "Gap report";
    case "job": return "Job";
    case "site": return "Site report";
    default: return p.t[0].toUpperCase() + p.t.slice(1);
  }
}

export type Ctx = {
  userId: string;
  sites: SiteRow[];
  open: (p: Panel) => void;      // push (Back returns here)
  replace: (p: Panel) => void;   // swap the current panel
  setTitle: (s: string) => void;
  changed: () => void;           // something was saved: refresh the calendar
};

/* ---------- small pieces ---------- */
const Bdg = ({ s }: { s: { label: string; tone: Tone } | undefined }) =>
  s ? <span className={`bdg ${s.tone}`}>{s.label}</span> : null;
const Loading = () => <p className="empty">Loading…</p>;
const Err = ({ m }: { m: string }) => <p className="err" role="alert">{m}</p>;
const LinkBtn = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" className="lnk" onClick={onClick}>{children}</button>
);

function Card({ date, time, title, badge, company, line, color, rows }: {
  date: string | null; time?: string | null; title: string; badge?: ReactNode; company: ReactNode; line: ReactNode; color: string;
  rows?: [string, ReactNode][];
}) {
  const p = date ? dayParts(date) : null;
  return (
    <article className="visit open">
      <div className="when">
        {p ? <><b>{p.day}</b><span>{p.month}</span><small>{p.weekday}</small></> : <b>—</b>}
        {time && <em>{time}</em>}
      </div>
      <div className="what">
        <div className="v-top"><span className="v-t" title={title}>{title}</span>{badge}</div>
        <div className="v-co">{company}</div>
        <div className="v-s" style={{ "--c": color } as CSSProperties}><i />{line}</div>
      </div>
      {rows && (
        <dl className="kv v-d">
          {rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v ?? "—"}</dd></Fragment>)}
        </dl>
      )}
    </article>
  );
}

function Row({ title, sub, badge, onClick }: { title: ReactNode; sub: ReactNode; badge?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="r2" onClick={onClick}>
      <b>{title}</b>
      <small>{sub}</small>
      {badge ?? <span />}
    </button>
  );
}

function Seg<T extends string>({ value, items, onChange, label }: { value: T; items: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg tabs" role="group" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/* ======================================================================== */
export function PanelView({ panel, ctx }: { panel: Panel; ctx: Ctx }) {
  switch (panel.t) {
    case "job": return <JobPanel id={panel.id} ctx={ctx} />;
    case "complaint": return <ComplaintPanel id={panel.id} ctx={ctx} />;
    case "inspection": return <InspectionPanel id={panel.id} ctx={ctx} />;
    case "meeting": return <MeetingPanel id={panel.id} ctx={ctx} />;
    case "site": return <SitePanel id={panel.id} ctx={ctx} />;
    case "list": return panel.id === "findings" ? <BranchesPanel ctx={ctx} /> : <ListPanel kind={panel.id} ctx={ctx} />;
    case "gap": return <GapReportPanel id={panel.id} task={panel.task} ctx={ctx} />;
    case "visit": return <SiteVisitPanel id={panel.id} ctx={ctx} />;
    case "finding": return <FindingPanel id={panel.id} ctx={ctx} />;
  }
}

/* ---------- Job: same layout as the Operations visit drawer (card · tabs · pane) ---------- */
/** "Verified", or "Complaint · Service issue" / "Complaint · Document issue". */
const decisionLabel = (decision: string, issue: string | null) =>
  decision === "complaint" ? `Complaint${issue ? ` · ${COMPLAINT_ISSUE[issue]?.label ?? issue}` : ""}` : "Verified";

/** The PCO's service report, laid out like the Operations report box. */
function ServiceReport({ j, file }: { j: JobRow; file: (p: string) => SignedFile | undefined }) {
  const items = j.items ?? [];
  const pick = (paths: (string | null | undefined)[] | null) => (paths ?? []).map((p) => (p ? file(p) : undefined)).filter((f): f is SignedFile => !!f);
  // Finding photos are stored under findings/<n>/; pair them with finding n's note.
  const found = j.found_photos ?? [];
  const byN: Record<string, string[]> = {};
  const loose: string[] = [];
  found.forEach((p) => { const m = /\/findings\/(\d+)\//.exec(p); if (m) (byN[m[1]] = byN[m[1]] ?? []).push(p); else loose.push(p); });
  const groups = (j.findings ?? []).map((note, i) => ({ note, photos: byN[i + 1] ?? [] }));
  if (loose.length) groups.push({ note: (j.findings ?? []).length ? "Other photos" : "Photos", photos: loose });
  const rows: [string, string][] = [
    ["Submitted by", `${j.submitted_by_name ?? "Unknown"} on ${fmtDate(karachiYmd(j.submitted_at!))}`],
    ["What happened", OUTCOME[j.outcome ?? ""] ?? j.outcome ?? "—"],
    ["Who did the work", j.team_names?.join(", ") || "—"],
  ];
  if (items.length) rows.push(["Items used", items.map((i) => `${i.name} ${i.qty} ${i.unit}`).join("; ")]);
  if (j.extras?.length) rows.push(["Extra treatment", j.extras.map((x) => x.work).join("; ")]);
  if (j.report_notes) rows.push(["Notes", j.report_notes]);
  if (j.challan_no) rows.push(["Challan", `${j.challan_no}${j.challan_date ? `, ${fmtDate(j.challan_date, { weekday: false })}` : ""}`]);
  const challan = pick([j.challan_file]);
  const during = pick(j.after_photos);
  const before = pick(j.before_photos);
  return (
    <div className="rep">
      <h4>Service report</h4>
      <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      {challan.length > 0 && <div className="md"><h5>Signed challan</h5><Photos files={challan} label="Signed challan" /></div>}
      {before.length > 0 && <div className="md"><h5>Before service</h5><Photos files={before} label="Before service photo" /></div>}
      {during.length > 0 && <div className="md"><h5>During service</h5><Photos files={during} label="During service photo" /></div>}
      {groups.length > 0 && (
        <div className="md">
          <h5>Findings</h5>
          {groups.map((g, i) => {
            const ph = pick(g.photos);
            return (
              <div key={i} className="fnd-r">
                {ph.length ? <Photos files={ph} label={`Finding ${i + 1} photo`} /> : <span />}
                <p>{g.note}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JobPanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const q = useQuery(async () => {
    const db = ento();
    const job = must(await db.from("v_jobs").select("*").eq("visit_id", id).maybeSingle()) as JobRow | null;
    if (!job) return null;
    const verifs = must(await db.from("job_verifications").select("*").eq("visit_id", id).order("created_at")) as VerificationRow[];
    return { job, verifs };
  }, [id]);
  const j = q.data?.job;
  const { setTitle } = ctx;
  useEffect(() => { if (j) setTitle(j.site_name); }, [j, setTitle]);
  const files = useSigned("ops-files", [...(j?.before_photos ?? []), ...(j?.after_photos ?? []), ...(j?.found_photos ?? []), j?.challan_file]);
  const pending = j?.verification_status === "pending" && !!j?.assignment_id;
  const [tab, setTab] = useState<"report" | "verify" | "complaint">("report");
  const [msg, setMsg] = useState<string | null>(null);

  if (q.error && !q.data) return <Err m={`Could not load this job: ${q.error}`} />;
  if (!q.data && q.loading) return <Loading />;
  if (!j) return <p className="empty">Job not found.</p>;

  const file = (p: string) => files.find((f) => f.path === p);
  const verifs = q.data!.verifs;
  const last = verifs[verifs.length - 1];
  const statusBadge = <Bdg s={j.verification_status === "complaint"
    ? { label: decisionLabel("complaint", j.last_issue), tone: "violet" } : VERIFICATION[j.verification_status ?? ""]} />;
  const done = (m: string) => { setMsg(m); q.reload(); ctx.changed(); };

  return (
    <>
      {msg && <p className="msg" role="status">{msg}</p>}
      {j.return_note && pending && <p className="hint">Back for verification (round {j.round}): {j.return_note}</p>}
      {j.kind === "complaint_service" && j.complaint_id && (
        <p className="hint">Complaint service for <LinkBtn onClick={() => ctx.open({ t: "complaint", id: j.complaint_id! })}>your complaint</LinkBtn>. Verify it, or mark it as a complaint again.</p>
      )}
      <Card
        date={j.visit_date} time={j.visit_time} title={j.site_name} badge={statusBadge}
        company={j.client_name}
        line={`${JOB_KIND[j.kind] ?? j.kind} · ${j.pco_name ?? "No PCO"}`}
        color="var(--t-svc)"
        rows={[
          ["Date", `${fmtDate(j.visit_date)} · ${j.visit_time}`],
          ["Site", <LinkBtn key="s" onClick={() => ctx.open({ t: "site", id: j.site_id })}>{j.site_name}, {j.client_name}{j.site_city ? ` · ${j.site_city}` : ""}</LinkBtn>],
          ["PCO", [j.pco_name, ...(j.crew_names ?? [])].filter(Boolean).join(", ") || "—"],
          ["Treatment", j.treatments?.length ? j.treatments.join(", ") : "—"],
          ["Note", j.visit_note || "—"],
        ]}
      />

      {!j.submitted_at ? (
        <p className="hint">Not completed by the PCO yet. It can be verified once the service report is in.</p>
      ) : pending ? (
        <>
          <div className="seg tabs" role="tablist" aria-label="Job">
            {([["report", "Report"], ["verify", "Verify"], ["complaint", "Complaint"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "report" && <ServiceReport j={j} file={file} />}
          {tab === "verify" && <VerifyForm assignmentId={j.assignment_id!} onDone={done} />}
          {tab === "complaint" && <JobComplaintForm assignmentId={j.assignment_id!} onDone={done} />}
        </>
      ) : (
        <>
          {/* Decided jobs are locked: the final decision and the job's history only (no report). */}
          {last && (
            <div className="rep">
              <h4>{last.decision === "complaint" ? "Marked as complaint" : "Final decision"} {statusBadge}</h4>
              <dl className="kv">
                <dt>Decision</dt><dd>{decisionLabel(last.decision, last.issue)}</dd>
                <dt>By</dt><dd>{last.created_by === ctx.userId ? "You" : last.verifier_name}</dd>
                <dt>On</dt><dd>{fmtDateTime(last.created_at)}</dd>
                {last.note && <><dt>{last.decision === "complaint" ? "Reason" : "Note"}</dt><dd className="pre">{last.note}</dd></>}
                {last.complaint_id && <><dt>Complaint</dt><dd><LinkBtn onClick={() => ctx.open({ t: "complaint", id: last.complaint_id! })}>See what Operations did</LinkBtn></dd></>}
              </dl>
              {last.decision === "complaint" && last.issue && <p className="note">{COMPLAINT_ISSUE[last.issue]?.action}</p>}
            </div>
          )}
          <JobHistory j={j} verifs={verifs} userId={ctx.userId} />
        </>
      )}
    </>
  );
}

/** Timeline of a job: scheduled → started → report submitted → each verification round. */
function JobHistory({ j, verifs, userId }: { j: JobRow; verifs: VerificationRow[]; userId: string }) {
  const steps: { title: string; meta?: string | null; body?: string | null; cls: string }[] = [
    { title: "Scheduled", meta: `${fmtDate(j.visit_date)} · ${j.visit_time}${j.pco_name ? ` · PCO ${j.pco_name}` : ""}`, cls: "on" },
  ];
  if (j.started_at) steps.push({ title: "Started by PCO", meta: fmtDateTime(j.started_at), cls: "on" });
  if (j.submitted_at) steps.push({ title: "Service report submitted", meta: `${j.submitted_by_name ?? "PCO"} · ${fmtDateTime(j.submitted_at)}`, cls: "on" });
  verifs.forEach((v, i) => {
    steps.push({
      title: `${decisionLabel(v.decision, v.issue)}${verifs.length > 1 ? ` (round ${v.round})` : ""}`,
      meta: `${v.created_by === userId ? "You" : v.verifier_name} · ${fmtDateTime(v.created_at)}`,
      body: v.note,
      cls: v.decision === "verified" ? "on" : "bad",
    });
    // A document issue that Operations corrected brings the job back for the next round.
    if (v.decision === "complaint" && v.issue === "document" && verifs[i + 1]) {
      steps.push({ title: "Documents corrected by Operations — back for verification", cls: "on" });
    }
  });
  if (j.verification_status === "pending" && j.round && j.round > 1 && verifs[verifs.length - 1]?.decision === "complaint") {
    steps.push({ title: "Documents corrected by Operations — back for verification", body: j.return_note, cls: "on" });
  }
  if (j.verification_status === "pending") steps.push({ title: "Waiting for your verification", cls: "todo" });
  return (
    <div className="rep">
      <h4>History</h4>
      <ol className="tl">
        {steps.map((s, i) => (
          <li key={i} className={s.cls}>
            <b>{s.title}</b>
            {s.meta && <div className="tl-m">{s.meta}</div>}
            {s.body && <div className="tl-b">{s.body}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Complaint ---------- */
function ComplaintPanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const q = useQuery(async () => {
    const db = ento();
    const c = must(await db.from("v_complaints").select("*").eq("id", id).maybeSingle()) as ComplaintRow | null;
    if (!c) return null;
    const [u, a] = await Promise.all([
      db.from("complaint_updates").select("*").eq("complaint_id", id).order("created_at"),
      db.from("attachments").select("*").eq("entity_type", "complaint").eq("entity_id", id),
    ]);
    return { c, updates: must(u) as ComplaintUpdateRow[], atts: must(a) as AttachmentRow[] };
  }, [id]);
  const c = q.data?.c;
  const { setTitle } = ctx;
  useEffect(() => { if (c) setTitle(`Complaint ${c.code}`); }, [c, setTitle]);
  const atts = q.data?.atts ?? [];
  const files = useSigned("ento-files", atts.map((a) => a.path), Object.fromEntries(atts.map((a) => [a.path, a.file_name])));

  if (q.error && !q.data) return <Err m={q.error} />;
  if (!q.data && q.loading) return <Loading />;
  if (!c) return <p className="empty">Complaint not found.</p>;
  const reached = COMPLAINT_FLOW.indexOf(c.status as (typeof COMPLAINT_FLOW)[number]);

  return (
    <>
      <Card
        date={karachiYmd(c.created_at)} time={karachiHm(c.created_at)} title={c.site_name}
        badge={<Bdg s={COMPLAINT_STATUS[c.status]} />}
        company={c.client_name}
        line={`${COMPLAINT_ISSUE[c.issue]?.label ?? c.issue} · ${c.job_code ?? "Job"}`}
        color="var(--red)"
        rows={[
          ["Complaint", c.code],
          ["Type", COMPLAINT_ISSUE[c.issue]?.label ?? c.issue],
          ["Site", <LinkBtn key="s" onClick={() => ctx.open({ t: "site", id: c.site_id })}>{c.site_name}, {c.client_name}</LinkBtn>],
          ["Service", <LinkBtn key="j" onClick={() => ctx.open({ t: "job", id: c.visit_id })}>{c.job_code} · {fmtDate(c.job_date)}</LinkBtn>],
          ["Marked", fmtDateTime(c.created_at)],
          ["Reason", <span key="d" className="pre">{c.description}</span>],
          ...(c.issue === "service" ? [["Complaint service", c.service_visit_id
            ? <LinkBtn key="cs" onClick={() => ctx.open({ t: "job", id: c.service_visit_id! })}>{c.service_job_code} · {fmtDate(c.service_date)}</LinkBtn>
            : "Not scheduled yet"] as [string, ReactNode]] : []),
        ]}
      />
      <p className="note">{COMPLAINT_ISSUE[c.issue]?.action}</p>
      {files.length > 0 && <div className="rep"><h4>Photos</h4><Photos files={files} label="Complaint photos" /></div>}
      <div className="rep">
        <h4>Status</h4>
        <ol className="tl">
          {COMPLAINT_FLOW.map((s, i) => <li key={s} className={i <= reached ? "on" : "todo"}>{COMPLAINT_STATUS[s].label}</li>)}
        </ol>
      </div>
      <div className="rep">
        <h4>Updates from Operations</h4>
        {!q.data!.updates.length && <p className="note">No updates yet.</p>}
        <ol className="tl">
          {q.data!.updates.map((u) => (
            <li key={u.id} className={u.kind === "status" ? "on" : ""}>
              <b>{u.kind === "status" ? COMPLAINT_STATUS[u.to_status ?? ""]?.label ?? u.to_status : u.kind === "response" ? "Response" : "Note"}</b>
              {" "}<span className="muted">· {u.created_by === ctx.userId ? "you" : u.author_name}</span>
              <div className="tl-m">{fmtDateTime(u.created_at)}</div>
              {u.message && <div className="tl-b">{u.message}</div>}
            </li>
          ))}
        </ol>
      </div>
      {c.status !== "resolved" && <CommentForm complaintId={c.id} onDone={q.reload} />}
    </>
  );
}

/* ---------- Inspection: assigned by Admin, the entomologist submits the report ---------- */
function InspectionPanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const q = useQuery(async () => {
    const db = ento();
    const t = must(await db.from("v_inspection_tasks").select("*").eq("id", id).maybeSingle()) as InspectionTaskRow | null;
    if (!t) return null;
    const visit = t.site_visit_id
      ? must(await db.from("v_site_visits").select("*").eq("id", t.site_visit_id).maybeSingle()) as SiteVisitRow | null
      : null;
    return { t, visit };
  }, [id]);
  const t = q.data?.t;
  const { setTitle } = ctx;
  useEffect(() => { if (t) setTitle(`Inspection ${t.code}`); }, [t, setTitle]);

  if (q.error && !q.data) return <Err m={q.error} />;
  if (!q.data && q.loading) return <Loading />;
  if (!t) return <p className="empty">This inspection is not assigned to you.</p>;
  const v = q.data!.visit;
  const early = t.status === "assigned" && t.inspection_date > todayYmd();
  const steps: { title: string; meta?: string | null; body?: string | null; cls: string }[] = [
    { title: "Assigned by Admin", meta: `${t.assigned_by_name} · ${fmtDateTime(t.assigned_at)}`, cls: "on" },
    { title: `Inspection ${fmtDate(t.inspection_date)} · ${t.inspection_time}`, cls: t.status === "submitted" || !early ? "on" : "todo" },
    t.status === "submitted"
      ? { title: "Report submitted", meta: `${fmtDateTime(t.submitted_at)}${v ? ` · ${visitSummary(v)}` : ""}`, cls: "on" }
      : { title: "Submit the inspection report", cls: "todo" },
  ];

  return (
    <>
      <Card
        date={t.inspection_date} time={t.inspection_time} title={t.site_name}
        badge={<Bdg s={INSPECTION_STATUS[t.status]} />}
        company={t.client_name}
        line={`Inspection ${t.code} · by ${t.assigned_by_name}`}
        color="var(--t-insp)"
        rows={[
          ["Date", `${fmtDate(t.inspection_date)} · ${t.inspection_time}`],
          ["Site", <LinkBtn key="s" onClick={() => ctx.open({ t: "site", id: t.site_id })}>{t.site_name}, {t.client_name}{t.site_city ? ` · ${t.site_city}` : ""}</LinkBtn>],
          ["Purpose", t.purpose],
          ["Instructions", <span key="i" className="pre">{t.instructions || "—"}</span>],
        ]}
      />
      <div className="rep">
        <h4>Progress</h4>
        <ol className="tl">
          {steps.map((s, i) => (
            <li key={i} className={s.cls}>
              <b>{s.title}</b>
              {s.meta && <div className="tl-m">{s.meta}</div>}
              {s.body && <div className="tl-b">{s.body}</div>}
            </li>
          ))}
        </ol>
      </div>
      {t.status === "assigned" ? (
        <div className="row">
          <button type="button" className="btn sm" disabled={early} onClick={() => ctx.open({ t: "gap", id: t.site_id, task: t.id })}>Submit report</button>
          <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "gap", id: t.site_id })}>Gap report</button>
          {early && <p className="note">You can submit the report from {fmtDate(t.inspection_date)}.</p>}
        </div>
      ) : (
        <div className="row">
          {v && <button type="button" className="btn sm" onClick={() => ctx.open({ t: "visit", id: v.id })}>Open report</button>}
          <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "gap", id: t.site_id })}>Gap report</button>
        </div>
      )}
    </>
  );
}

/* ---------- Meeting ---------- */
function MeetingPanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const q = useQuery(async () => must(await ento().from("v_my_meetings").select("*").eq("id", id).maybeSingle()) as MeetingRow | null, [id]);
  const m = q.data;
  const { setTitle } = ctx;
  useEffect(() => { if (m) setTitle(m.title); }, [m, setTitle]);
  if (q.error && !q.data) return <Err m={q.error} />;
  if (!q.data && q.loading) return <Loading />;
  if (!m) return <p className="empty">You are not invited to this meeting.</p>;
  const cancelled = m.status === "cancelled";
  return (
    <>
      {cancelled && <p className="err">Cancelled by Admin{m.cancel_reason ? `: ${m.cancel_reason}` : "."}</p>}
      {m.status === "rescheduled" && <p className="hint">Admin moved this meeting. Check the new time.</p>}
      <Card
        date={karachiYmd(m.starts_at)} time={karachiHm(m.starts_at)} title={m.title}
        badge={cancelled ? <Bdg s={MEETING_STATUS.cancelled} /> : <Bdg s={RSVP[m.rsvp]} />}
        company={m.location || "Online"}
        line={`Meeting · by ${m.scheduled_by_name}`}
        color="var(--t-meet)"
        rows={[
          ["Date", `${fmtDate(karachiYmd(m.starts_at))} · ${karachiHm(m.starts_at)}${m.ends_at ? `–${karachiHm(m.ends_at)}` : ""}`],
          ["Location", m.location || "—"],
          ["Link", m.online_link ? <a key="l" href={m.online_link} target="_blank" rel="noreferrer">Join online</a> : "—"],
          ["Agenda", <span key="a" className="pre">{m.agenda || "—"}</span>],
          ["Attendance", ATTENDANCE[m.attendance]],
        ]}
      />
      <div className="dr-tabs">
        <MeetingResponse meetingId={m.id} rsvp={m.rsvp} attendance={m.attendance} notes={m.my_notes} startsAt={m.starts_at} cancelled={cancelled} />
        <p className="note" style={{ marginTop: 8 }}>Only Admin can edit, reschedule or cancel a meeting.</p>
      </div>
    </>
  );
}

/* ---------- Site report ---------- */
const SITE_PAGE = 15;
function SitePanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const [tab, setTab] = useState<"jobs" | "findings" | "inspections" | "complaints">("jobs");
  const [kind, setKind] = useState("");
  const [limit, setLimit] = useState(SITE_PAGE);
  const site = ctx.sites.find((s) => s.site_id === id);
  const { setTitle } = ctx;
  useEffect(() => { if (site) setTitle(site.site_name); }, [site, setTitle]);

  const head = useQuery(async () => {
    const db = ento();
    const c = { count: "exact" as const, head: true };
    const [jobs, ver, pend, cmp, issues, open, last] = await Promise.all([
      db.from("v_jobs").select("visit_id", c).eq("site_id", id).not("verification_status", "is", null),
      db.from("job_assignments").select("id", c).eq("site_id", id).eq("verification_status", "verified"),
      db.from("job_assignments").select("id", c).eq("site_id", id).eq("verification_status", "pending"),
      db.from("job_assignments").select("id", c).eq("site_id", id).eq("verification_status", "complaint"),
      opsDb().from("site_issues").select("id,description,created_at").eq("site_id", id).eq("open", true).order("created_at", { ascending: false }),
      db.from("site_findings").select("id", c).eq("site_id", id).eq("status", "open"),
      db.from("site_visits").select("id,visit_date,created_by,created_by_name").eq("site_id", id).order("visit_date", { ascending: false }).order("created_at", { ascending: false }).limit(1),
    ]);
    return {
      jobs: jobs.count ?? 0, ver: ver.count ?? 0, pend: pend.count ?? 0, cmp: cmp.count ?? 0, issues: must(issues) as { id: string; description: string }[],
      open: open.count ?? 0, last: (must(last) as Pick<SiteVisitRow, "id" | "visit_date" | "created_by" | "created_by_name">[])[0] ?? null,
    };
  }, [id]);

  const list = useQuery(async () => {
    const db = ento();
    if (tab === "jobs") {
      let b = db.from("v_jobs").select("visit_id,job_code,kind,visit_date,pco_name,items,findings,verification_status,last_issue", { count: "exact" }).eq("site_id", id).not("verification_status", "is", null);
      if (kind) b = b.eq("kind", kind);
      const r = await b.order("visit_date", { ascending: false }).range(0, limit - 1);
      return { rows: must(r) as JobRow[], count: r.count ?? 0 };
    }
    if (tab === "findings") return { rows: must(await db.from("v_site_findings").select("*").eq("site_id", id).order("status", { ascending: false }).order("found_on", { ascending: false }).limit(100)) as FindingRow[], count: 0 };
    if (tab === "inspections") return { rows: must(await db.from("v_inspection_tasks").select("*").eq("site_id", id).order("inspection_date", { ascending: false }).limit(100)) as InspectionTaskRow[], count: 0 };
    return { rows: must(await db.from("v_complaints").select("*").eq("site_id", id).order("created_at", { ascending: false }).limit(100)) as ComplaintRow[], count: 0 };
  }, [id, tab, kind, limit]);

  if (!site) return <p className="empty">Site not found.</p>;
  const h = head.data;

  return (
    <>
      <section className="sitecard">
        <div className="sc-t">
          <b>{site.site_name}</b><span>{site.client_name}{site.city ? ` · ${site.city}` : ""}</span>
          {h && (h.last
            ? <LinkBtn onClick={() => ctx.open({ t: "visit", id: h.last!.id })}>Last inspection {fmtDate(h.last.visit_date, { weekday: false })} ({sinceDay(h.last.visit_date)}) · {h.last.created_by === ctx.userId ? "you" : h.last.created_by_name}</LinkBtn>
            : <span>No inspection report yet</span>)}
        </div>
        <div className="stats">
          <span><b>{h?.pend ?? "–"}</b>pending</span>
          <span><b>{h?.ver ?? "–"}</b>verified</span>
          <span><b>{h?.cmp ?? "–"}</b>complaint</span>
          <span><b style={h?.open ? { color: "var(--red)" } : undefined}>{h?.open ?? "–"}</b>findings</span>
        </div>
        <div className="acts">
          <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "gap", id })}>Gap report</button>
        </div>
      </section>
      {h && h.issues.length > 0 && (
        <section className="issues">
          <h3>Open issues from PCO reports</h3>
          <ul>{h.issues.map((i) => <li key={i.id}><span>{i.description}</span></li>)}</ul>
        </section>
      )}
      <div className="seg-w">
        <Seg value={tab} onChange={(v) => { setTab(v); setLimit(SITE_PAGE); }} label="Site report"
          items={[["jobs", `Jobs${h ? ` ${h.jobs}` : ""}`], ["findings", `Findings${h?.open ? ` ${h.open}` : ""}`], ["inspections", "Inspections"], ["complaints", "Complaints"]]} />
      </div>
      {tab === "jobs" && (
        <div className="fld">
          <select aria-label="Job type" value={kind} onChange={(e) => { setKind(e.target.value); setLimit(SITE_PAGE); }}>
            <option value="">All job types</option>
            {Object.entries(JOB_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      )}
      {list.error && <Err m={list.error} />}
      {!list.data && list.loading ? <Loading /> : list.data && (
        <section className="issues">
          {tab === "jobs" && ((list.data.rows as JobRow[]).length ? (list.data.rows as JobRow[]).map((j) => (
            <Row key={j.visit_id} onClick={() => ctx.open({ t: "job", id: j.visit_id })}
              title={`${fmtDate(j.visit_date)} · ${j.job_code ?? JOB_KIND[j.kind]}`}
              sub={[JOB_KIND[j.kind], j.pco_name, j.items?.length ? j.items.map((i) => i.name).join(", ") : null, j.findings?.length ? `${j.findings.length} observation${j.findings.length > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ")}
              badge={<JobBadge j={j} />} />
          )) : <p className="empty">No completed jobs.</p>)}
          {tab === "findings" && ((list.data.rows as FindingRow[]).length ? (list.data.rows as FindingRow[]).map((f) => (
            <FindingItem key={f.id} f={f} ctx={ctx} />
          )) : <p className="empty">No findings recorded. They are added in inspection reports.</p>)}
          {tab === "inspections" && ((list.data.rows as InspectionTaskRow[]).length ? (list.data.rows as InspectionTaskRow[]).map((t) => (
            <Row key={t.id} onClick={() => ctx.open({ t: "inspection", id: t.id })} title={`${fmtDate(t.inspection_date)} · ${t.code}`}
              sub={`${t.purpose} · by ${t.assigned_by_name}`} badge={<Bdg s={INSPECTION_STATUS[t.status]} />} />
          )) : <p className="empty">No inspections assigned at this site.</p>)}
          {tab === "complaints" && ((list.data.rows as ComplaintRow[]).length ? (list.data.rows as ComplaintRow[]).map((c) => (
            <Row key={c.id} onClick={() => ctx.open({ t: "complaint", id: c.id })} title={`${c.code} · ${COMPLAINT_ISSUE[c.issue]?.label ?? c.issue}`}
              sub={`${fmtDate(karachiYmd(c.created_at))} · ${c.job_code} · ${c.description}`} badge={<Bdg s={COMPLAINT_STATUS[c.status]} />} />
          )) : <p className="empty">No complaints.</p>)}
        </section>
      )}
      {tab === "jobs" && list.data && list.data.count > limit && (
        <div className="row"><button type="button" className="btn alt sm" onClick={() => setLimit((l) => l + SITE_PAGE)}>Show more ({list.data.count - limit} left)</button></div>
      )}
      <p className="note">PCO reports are read-only here. Corrections are made by Operations and earlier versions are kept.</p>
    </>
  );
}

/** A job's verification badge ("Complaint · Service issue" for complaints). */
function JobBadge({ j }: { j: Pick<JobRow, "verification_status" | "last_issue" | "round"> }) {
  if (j.verification_status === "complaint") return <Bdg s={{ label: decisionLabel("complaint", j.last_issue), tone: "violet" }} />;
  if (j.verification_status === "pending" && (j.round ?? 1) > 1) return <span className="bdg red">Back to verify</span>;
  return <Bdg s={VERIFICATION[j.verification_status ?? ""]} />;
}

/* ---------- Site inspections: visit · finding ---------- */
const pestBadge = (p: string | null) => (p ? <span className={`bdg ${PEST_TONE[p] ?? "gray"}`}>Activity {PEST_ACTIVITY[p]?.toLowerCase() ?? p}</span> : null);
const findingTitle = (f: Pick<FindingRow, "area" | "department" | "code">) => `${[f.department, f.area].filter(Boolean).join(" · ") || "Finding"} · ${f.code}`;
export function visitSummary(v: Pick<SiteVisitRow, "new_findings" | "fixed_count" | "not_fixed_count">) {
  return [
    v.new_findings ? `${v.new_findings} new` : null,
    v.fixed_count ? `${v.fixed_count} fixed` : null,
    v.not_fixed_count ? `${v.not_fixed_count} not fixed` : null,
  ].filter(Boolean).join(" · ") || "Notes only";
}
/** "today", "yesterday", "5 days ago" for a yyyy-mm-dd date. */
export function sinceDay(d: string) {
  const n = Math.round((Date.parse(`${todayYmd()}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

/** One finding in a list: area · code, when found / fixed, description, severity or Fixed badge. */
function FindingItem({ f, ctx }: { f: FindingRow; ctx: Ctx }) {
  return (
    <Row onClick={() => ctx.open({ t: "finding", id: f.id })} title={findingTitle(f)}
      sub={`${f.status === "fixed" ? `Fixed ${fmtDate(f.fixed_on, { weekday: false, year: false })}` : `Found ${fmtDate(f.found_on, { weekday: false, year: false })}${f.times_not_fixed ? ` · not fixed ${f.times_not_fixed}×` : ""}`} · ${f.description}`}
      badge={f.status === "open" ? <Bdg s={GAP_CLASS[f.severity]} /> : <Bdg s={FINDING_STATUS.fixed} />} />
  );
}

function SiteVisitPanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const q = useQuery(async () => {
    const db = ento();
    const v = must(await db.from("v_site_visits").select("*").eq("id", id).maybeSingle()) as SiteVisitRow | null;
    if (!v) return null;
    const [found, checks, atts] = await Promise.all([
      db.from("v_site_findings").select("*").eq("found_visit_id", id).order("code"),
      db.from("finding_checks").select("*").eq("site_visit_id", id).order("created_at"),
      db.from("attachments").select("*").eq("entity_type", "site_visit").eq("entity_id", id),
    ]);
    const cks = must(checks) as FindingCheckRow[];
    const checked = cks.length
      ? (must(await db.from("v_site_findings").select("*").in("id", cks.map((c) => c.finding_id))) as FindingRow[])
      : [];
    return { v, found: must(found) as FindingRow[], checks: cks, checked, atts: must(atts) as AttachmentRow[] };
  }, [id]);
  const v = q.data?.v;
  const { setTitle } = ctx;
  useEffect(() => { if (v) setTitle(`Inspection report · ${v.site_name}`); }, [v, setTitle]);
  const atts = q.data?.atts ?? [];
  const files = useSigned("ento-files", atts.map((a) => a.path), Object.fromEntries(atts.map((a) => [a.path, a.file_name])));

  if (q.error && !q.data) return <Err m={q.error} />;
  if (!q.data && q.loading) return <Loading />;
  if (!v) return <p className="empty">Visit not found.</p>;
  const { found, checks, checked } = q.data!;
  const byId = new Map(checked.map((f) => [f.id, f]));

  return (
    <>
      <Card
        date={v.visit_date} title={v.site_name} badge={pestBadge(v.pest_activity)}
        company={v.client_name}
        line={`Inspection report ${v.code} · ${v.created_by === ctx.userId ? "you" : v.created_by_name}`}
        color="var(--t-insp)"
        rows={[
          ["Inspection", v.inspection_id ? <LinkBtn key="i" onClick={() => ctx.open({ t: "inspection", id: v.inspection_id! })}>Assigned inspection</LinkBtn> : "—"],
          ["Date", `${fmtDate(v.visit_date)} (${sinceDay(v.visit_date)})`],
          ["Site", <LinkBtn key="s" onClick={() => ctx.open({ t: "site", id: v.site_id })}>{v.site_name}, {v.client_name}{v.site_city ? ` · ${v.site_city}` : ""}</LinkBtn>],
          ["By", v.created_by === ctx.userId ? "You" : v.created_by_name],
          ["Pest activity", v.pest_activity ? PEST_ACTIVITY[v.pest_activity] : "Not recorded"],
          ["Notes", <span key="n" className="pre">{v.notes || "—"}</span>],
        ]}
      />
      {files.length > 0 && <div className="rep"><h4>Visit photos</h4><Photos files={files} label="Visit photos" /></div>}
      {/* One list: earlier findings checked on this visit, then the ones found on it. */}
      <div className="rep">
        <h4>Findings ({visitSummary(v) === "Notes only" ? "none" : visitSummary(v)})</h4>
        {checks.length + found.length ? (
          <div>
            {checks.map((c) => {
              const f = byId.get(c.finding_id);
              return (
                <Row key={c.id} onClick={() => ctx.open({ t: "finding", id: c.finding_id })}
                  title={f ? findingTitle(f) : "Finding"}
                  sub={`Earlier finding${f ? ` from ${fmtDate(f.found_on, { weekday: false, year: false })}` : ""} · ${c.note || f?.description || ""}`}
                  badge={<Bdg s={CHECK_RESULT[c.result]} />} />
              );
            })}
            {found.map((f) => (
              <Row key={f.id} onClick={() => ctx.open({ t: "finding", id: f.id })} title={findingTitle(f)}
                sub={`New · ${GAP_CLASS[f.severity]?.label ?? f.severity} · ${f.description}`}
                badge={f.status === "fixed" ? <Bdg s={FINDING_STATUS.fixed} /> : <span className="bdg violet">New</span>} />
            ))}
          </div>
        ) : <p className="note">No findings in this report.</p>}
      </div>
      <div className="row">
        <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "gap", id: v.site_id })}>Gap report</button>
      </div>
    </>
  );
}

function FindingPanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const q = useQuery(async () => {
    const db = ento();
    const f = must(await db.from("v_site_findings").select("*").eq("id", id).maybeSingle()) as FindingRow | null;
    if (!f) return null;
    const [checks, atts, others] = await Promise.all([
      db.from("finding_checks").select("*").eq("finding_id", id),
      db.from("attachments").select("*").eq("entity_type", "site_finding").eq("entity_id", id),
      db.from("v_site_findings").select("*").eq("site_id", f.site_id).neq("id", id)
        .order("status", { ascending: false }).order("found_on", { ascending: false }).order("code").limit(100),
    ]);
    const cks = must(checks) as FindingCheckRow[];
    const visits = must(await db.from("v_site_visits").select("id,code,visit_date,created_by,created_by_name")
      .in("id", [f.found_visit_id, ...cks.map((c) => c.site_visit_id)])) as SiteVisitRow[];
    return { f, checks: cks, visits, atts: must(atts) as AttachmentRow[], others: must(others) as FindingRow[] };
  }, [id]);
  const f = q.data?.f;
  const { setTitle } = ctx;
  useEffect(() => { if (f) setTitle(`Finding ${f.code}`); }, [f, setTitle]);
  const atts = q.data?.atts ?? [];
  const files = useSigned("ento-files", atts.map((a) => a.path), Object.fromEntries(atts.map((a) => [a.path, a.file_name])));

  if (q.error && !q.data) return <Err m={q.error} />;
  if (!q.data && q.loading) return <Loading />;
  if (!f) return <p className="empty">Finding not found.</p>;
  const visit = new Map(q.data!.visits.map((v) => [v.id, v]));
  const who = (uid: string, name: string) => (uid === ctx.userId ? "you" : name);
  const checks = [...q.data!.checks].sort((a, b) =>
    (visit.get(a.site_visit_id)?.visit_date ?? "").localeCompare(visit.get(b.site_visit_id)?.visit_date ?? "") || a.created_at.localeCompare(b.created_at));
  const steps: { title: string; meta?: string; body?: string | null; cls: string; visitId?: string }[] = [
    { title: "Found", meta: `${fmtDate(f.found_on)} · ${f.found_visit_code} · ${who(f.created_by, f.created_by_name)}`, body: f.description, cls: "bad", visitId: f.found_visit_id },
    ...checks.map((c) => {
      const v = visit.get(c.site_visit_id);
      return {
        title: CHECK_RESULT[c.result].label,
        meta: `${v ? `${fmtDate(v.visit_date)} · ${v.code} · ` : ""}${who(c.created_by, c.created_by_name)}`,
        body: c.note, cls: c.result === "fixed" ? "on" : "bad", visitId: c.site_visit_id,
      };
    }),
  ];
  if (f.status === "open") steps.push({ title: "Waiting to be fixed — checked on the next inspection at this site", cls: "todo" });

  return (
    <>
      <Card
        date={f.found_on} title={f.site_name} badge={<Bdg s={FINDING_STATUS[f.status]} />}
        company={f.client_name}
        line={`${FINDING_CATEGORY[f.category] ?? f.category} · ${GAP_CLASS[f.severity]?.label ?? f.severity}`}
        color={f.status === "open" ? "var(--red)" : "var(--t-svc)"}
        rows={[
          ["Finding", f.code],
          ["Site", <LinkBtn key="s" onClick={() => ctx.open({ t: "site", id: f.site_id })}>{f.site_name}, {f.client_name}</LinkBtn>],
          ["Category", FINDING_CATEGORY[f.category] ?? f.category],
          ["Department", f.department || "—"],
          ["Location", f.area || "—"],
          ["Observation", <span key="d" className="pre">{f.description}</span>],
          ["Risk", <span key="r" className="pre">{f.risk || "—"}</span>],
          ["Recommendation", <span key="rc" className="pre">{f.recommendation || "—"}</span>],
          ["Classification", <Bdg key="v" s={GAP_CLASS[f.severity]} />],
          ["Responsibility", f.responsibility ? RESPONSIBILITY[f.responsibility] ?? f.responsibility : "—"],
          ["Found", <LinkBtn key="f" onClick={() => ctx.open({ t: "visit", id: f.found_visit_id })}>{fmtDate(f.found_on)} · {f.found_visit_code}</LinkBtn>],
          ["Status", f.status === "fixed"
            ? `Fixed ${fmtDate(f.fixed_on)}${f.fixed_by_name ? ` · ${f.fixed_by_name}` : ""}`
            : `Open ${sinceDay(f.found_on).replace(" ago", "")}${f.times_not_fixed ? ` · not fixed on ${f.times_not_fixed} visit${f.times_not_fixed > 1 ? "s" : ""}` : ""}`],
        ]}
      />
      {files.length > 0 && <div className="rep"><h4>Photos</h4><Photos files={files} label="Finding photos" /></div>}
      <div className="rep">
        <h4>History</h4>
        <ol className="tl">
          {steps.map((s, i) => (
            <li key={i} className={s.cls}>
              <b>{s.title}</b>
              {s.meta && <div className="tl-m">{s.visitId ? <LinkBtn onClick={() => ctx.open({ t: "visit", id: s.visitId! })}>{s.meta}</LinkBtn> : s.meta}</div>}
              {s.body && <div className="tl-b">{s.body}</div>}
            </li>
          ))}
        </ol>
      </div>
      <div className="row">
        <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "gap", id: f.site_id })}>Gap report</button>
      </div>
      <div className="rep">
        <h4>Other findings at {f.site_name} ({(() => {
          const o = q.data!.others, n = o.filter((x) => x.status === "open").length;
          return o.length ? `${n} open · ${o.length - n} fixed` : "none";
        })()})</h4>
        {q.data!.others.length
          ? <div>{q.data!.others.map((x) => <FindingItem key={x.id} f={x} ctx={ctx} />)}</div>
          : <p className="note">This is the only finding recorded at this site.</p>}
      </div>
    </>
  );
}

/* ---------- Site inspections: Client → Branch list, and each branch's gap report ---------- */
function BranchesPanel({ ctx }: { ctx: Ctx }) {
  const [search, setSearch] = useState("");
  const [shut, setShut] = useState<string[]>([]);   // collapsed clients
  const q = useQuery(async () =>
    must(await ento().from("v_site_inspection_summary").select("*").order("client_name").order("site_name")) as SiteSummaryRow[], []);

  const term = search.trim().toLowerCase();
  const groups: { id: string; name: string; open: number; sites: SiteSummaryRow[] }[] = [];
  for (const r of q.data ?? []) {
    if (term && ![r.client_name, r.site_name ?? "", r.site_city ?? ""].some((x) => x.toLowerCase().includes(term))) continue;
    let g = groups[groups.length - 1];
    if (!g || g.id !== r.client_id) groups.push(g = { id: r.client_id, name: r.client_name, open: 0, sites: [] });
    if (r.site_id) g.sites.push(r);
    g.open += r.open_count;
  }

  return (
    <>
      <div className="fld"><input type="search" aria-label="Search" placeholder="Search client or branch…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {q.error && <Err m={q.error} />}
      {!q.data && q.loading ? <Loading /> : (
        <section className="issues tree" aria-label="Clients and branches">
          {!groups.length && <p className="empty">{term ? "No client or branch matches." : "No clients yet."}</p>}
          {groups.map((g) => {
            const open = !!term || !shut.includes(g.id);
            return (
              <div key={g.id} className="tr-c">
                <button type="button" className="tr-h" aria-expanded={open}
                  onClick={() => setShut((l) => (l.includes(g.id) ? l.filter((x) => x !== g.id) : [...l, g.id]))}>
                  <i aria-hidden="true">{open ? "▾" : "▸"}</i>
                  <span className="tr-av" aria-hidden="true">{g.name.trim().slice(0, 1).toUpperCase()}</span>
                  <b>{g.name}</b>
                  <small>{g.sites.length ? `${g.sites.length} branch${g.sites.length > 1 ? "es" : ""}` : "No branches"}</small>
                  <span />
                </button>
                {open && !g.sites.length && <p className="tr-e">No branches for this client yet.</p>}
                {open && g.sites.map((s) => (
                  <button key={s.site_id} type="button" className="tr-s" onClick={() => ctx.open({ t: "gap", id: s.site_id! })}>
                    <span className="tr-t">
                      <b>{s.site_name}{s.site_city ? <span> · {s.site_city}</span> : null}</b>
                      <small>{s.visit_count
                        ? `${s.visit_count} visit${s.visit_count > 1 ? "s" : ""} · last ${fmtDate(s.last_visit_date, { weekday: false })} (${sinceDay(s.last_visit_date!)})`
                        : "Not visited yet"}</small>
                    </span>
                    <span className="tr-n">
                      {s.open_count > 0 && <span className="bdg red">{s.open_count} open</span>}
                      {s.fixed_count > 0 && <span className="bdg green">{s.fixed_count} closed</span>}
                      {!s.open_count && !s.fixed_count && <span className="bdg gray">No findings</span>}
                      <i className="tr-go" aria-hidden="true">›</i>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

/** Small photo picker for a table cell (the gap report's pictorial view). */
function MiniPhotos({ files, onChange, label }: { files: File[]; onChange: (f: File[]) => void; label: string }) {
  const id = useId();
  const [err, setErr] = useState<string | null>(null);
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="mp">
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="mp-t">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {previews[i] ? <img src={previews[i]!} alt={f.name} /> : <em>PDF</em>}
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, k) => k !== i))}>×</button>
        </span>
      ))}
      {files.length < MAX_FILES && (
        <label className="mp-add" htmlFor={id} title={`Add ${label}`}>
          <input id={id} type="file" accept="image/*,application/pdf" multiple
            onChange={(e) => {
              const next = [...files, ...Array.from(e.target.files ?? [])];
              const problem = checkFiles(next);
              setErr(problem);
              if (!problem) onChange(next);
              e.target.value = "";
            }} />
          + Photo
        </label>
      )}
      {err && <small className="ferr">{err}</small>}
    </div>
  );
}

const newDraft = (category: string): DraftFinding => ({
  key: Date.now() + Math.random(), category, department: "", area: "", description: "", risk: "",
  recommendation: "", severity: "medium", responsibility: "client", files: [],
});

/**
 * The branch's findings as a client gap report: each finding shows the date the gap was found and the date it was fixed.
 * Opened from an assigned inspection (`task`), the same table becomes the inspection report form:
 * a "This visit" column to mark each open finding Open / Closed, and new finding rows typed
 * straight into their section.
 */
function GapReportPanel({ id, task, ctx }: { id: string; task?: string; ctx: Ctx }) {
  const q = useQuery(async () => {
    const db = ento();
    const [f, v, k, s, t] = await Promise.all([
      db.from("v_site_findings").select("*").eq("site_id", id).order("found_on").order("code"),
      db.from("v_site_visits").select("id,code,visit_date,created_at,created_by,created_by_name,pest_activity,notes,new_findings,fixed_count,not_fixed_count")
        .eq("site_id", id).order("visit_date").order("created_at"),
      db.from("v_finding_checks").select("*").eq("site_id", id),
      db.from("v_site_inspection_summary").select("*").eq("site_id", id).maybeSingle(),
      task ? db.from("v_inspection_tasks").select("*").eq("id", task).maybeSingle() : Promise.resolve({ data: null, error: null, count: null }),
    ]);
    const findings = must(f) as FindingRow[];
    const atts = findings.length
      ? (must(await db.from("attachments").select("*").eq("entity_type", "site_finding").in("entity_id", findings.map((x) => x.id))) as AttachmentRow[])
      : [];
    return {
      findings, visits: must(v) as SiteVisitRow[], checks: must(k) as CheckGridRow[], site: must(s) as SiteSummaryRow | null, atts,
      task: must(t) as InspectionTaskRow | null,
    };
  }, [id, task]);
  const site = q.data?.site;
  const { setTitle } = ctx;
  useEffect(() => { if (site) setTitle(`Gap report · ${site.site_name}`); }, [site, setTitle]);
  const atts = q.data?.atts ?? [];
  const files = useSigned("ento-files", atts.map((a) => a.path), Object.fromEntries(atts.map((a) => [a.path, a.file_name])));

  /* the inspection report, filled in on the table */
  const [editOn, setEditing] = useState(!!task);
  const [date, setDate] = useState(todayYmd());
  const [pest, setPest] = useState("");
  const [notes, setNotes] = useState("");
  const [vfiles, setVfiles] = useState<File[]>([]);
  const [checks, setChecks] = useState<Record<string, DraftCheck>>({});
  const [drafts, setDrafts] = useState<DraftFinding[]>([]);
  const [addCat, setAddCat] = useState("structural");
  const [bad, setBad] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, start] = useTransition();

  if (q.error && !q.data) return <Err m={q.error} />;
  if (!q.data && q.loading) return <Loading />;
  if (!site) return <p className="empty">Branch not found.</p>;
  const { findings, visits } = q.data!;
  const insp = q.data!.task;
  // The report can be filled in only for an assigned inspection that is due and not submitted yet.
  const canReport = !!insp && insp.status === "assigned" && insp.inspection_date <= todayYmd();
  const editing = editOn && canReport;

  const done = new Map(q.data!.checks.map((c) => [`${c.finding_id}|${c.site_visit_id}`, c]));
  const photos = (fid: string) => {
    const mine = new Set(atts.filter((a) => a.entity_id === fid).map((a) => a.path));
    return files.filter((x) => mine.has(x.path));
  };
  const fixNote = (f: FindingRow) => (f.fixed_visit_id ? done.get(`${f.id}|${f.fixed_visit_id}`)?.note ?? null : null);
  // Latest "not fixed" check per open finding, so the report shows what is still wrong.
  const stillOpen = new Map<string, CheckGridRow>();
  for (const c of [...q.data!.checks].sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.created_at.localeCompare(b.created_at)))
    if (c.result === "not_fixed") stillOpen.set(c.finding_id, c);
  const catOf = (c: string) => (FINDING_CATEGORY[c] ? c : "other");
  const sections = FINDING_CATEGORY_ORDER
    .map((k) => ({ key: k, rows: findings.filter((f) => catOf(f.category) === k), drafts: editing ? drafts.filter((d) => d.category === k) : [] }))
    .filter((s) => s.rows.length || s.drafts.length);
  const cols = 11 + (editing ? 1 : 0);
  const checkable = (f: FindingRow) => f.status === "open" && date >= f.found_on;
  const marked = Object.entries(checks).filter(([fid, c]) => c.result && findings.some((f) => f.id === fid && checkable(f)));
  const nClosed = marked.filter(([, c]) => c.result === "fixed").length;
  let n = 0;

  const setCheck = (fid: string, patch: Partial<DraftCheck>) =>
    setChecks((c) => ({ ...c, [fid]: { ...(c[fid] ?? { result: "", note: "" }), ...patch } }));
  const toggle = (fid: string, r: "fixed" | "not_fixed") => setCheck(fid, { result: checks[fid]?.result === r ? "" : r });
  const editDraft = (key: number, patch: Partial<DraftFinding>) => setDrafts((l) => l.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const addDraft = (cat: string) => { setDrafts((l) => [...l, newDraft(cat)]); setErr(null); };
  const reset = () => {
    setEditing(false); setDate(todayYmd()); setPest(""); setNotes(""); setVfiles([]);
    setChecks({}); setDrafts([]); setBad({}); setErr(null);
  };
  const begin = () => { setMsg(null); setEditing(true); };
  const save = () => {
    if (!insp) return;
    const b: Record<string, string> = {};
    if (!date || date > todayYmd()) b.date = "Pick today or an earlier date";
    else if (date < insp.inspection_date) b.date = `Pick ${fmtDate(insp.inspection_date, { weekday: false })} or later`;
    for (const d of drafts) if (d.description.trim().length < 5) b[`d${d.key}`] = "Write the observation (5+ characters)";
    setBad(b);
    if (Object.keys(b).length) return setErr("Please fix the highlighted fields.");
    if (!marked.length && !drafts.length && !notes.trim()) return setErr("Mark an open finding Open / Closed, add a finding, or write a note.");
    setErr(null);
    start(async () => {
      const r = await saveSiteVisit(ctx.userId, {
        inspectionId: insp.id, date, pest, notes, files: vfiles, findings: drafts, checks: Object.fromEntries(marked),
      });
      if (!r.ok) return setErr(r.error);
      reset();
      setMsg(r.message ?? "Report submitted.");
      ctx.changed();
      ctx.replace({ t: "inspection", id: insp.id });
    });
  };

  return (
    <>
      {!editing ? (
        <div className="gap-tools gap-noprint">
          {canReport && <button type="button" className="btn sm" onClick={begin}>Submit report for {insp!.code}</button>}
          <button type="button" className="btn alt sm" onClick={() => window.print()} disabled={!findings.length}>Print / PDF</button>
          <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "site", id })}>Site report</button>
          {msg && <p className="msg" role="status">{msg}</p>}
          {insp && !canReport && (
            <p className="note">{insp.status === "submitted" ? `The report of ${insp.code} was already submitted.` : `You can submit the report of ${insp.code} from ${fmtDate(insp.inspection_date)}.`}</p>
          )}
        </div>
      ) : (
        <section className="gap-edit gap-noprint" aria-label="Inspection report">
          <div className="ge-h">
            <b>Inspection report · {insp!.code} · {insp!.purpose}</b>
            <span>Mark each open finding <span className="gs open">Open</span> or <span className="gs closed">Closed</span> in the <em>This visit</em> column, and add new findings to their section.</span>
          </div>
          <div className="ge-g">
            <div className="fld">
              <label htmlFor="ge-date">Inspection date<span className="req" aria-hidden="true">*</span></label>
              <input id="ge-date" type="date" max={todayYmd()} min={insp!.inspection_date} value={date} onChange={(e) => setDate(e.target.value)} />
              {bad.date && <span className="ferr">{bad.date}</span>}
            </div>
            <div className="fld">
              <label htmlFor="ge-pest">Pest activity</label>
              <select id="ge-pest" value={pest} onChange={(e) => setPest(e.target.value)}>
                <option value="">Not recorded</option>
                {Object.entries(PEST_ACTIVITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="fld ge-n">
              <label htmlFor="ge-notes">Report notes</label>
              <textarea id="ge-notes" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="General observations, who you met, advice given…" />
            </div>
            <div className="fld">
              <span className="lb">Photos</span>
              <MiniPhotos files={vfiles} onChange={setVfiles} label="inspection photo" />
            </div>
          </div>
        </section>
      )}

      <div className="gap-print">
        <header className="gap-head">
          <div className="gh-t">
            <span className="gh-k">Gap report</span>
            <h3>{site.client_name}</h3>
            <p>{site.site_name}{site.site_city ? ` · ${site.site_city}` : ""}</p>
          </div>
          <dl>
            <div><dt>Visits</dt><dd>{visits.length}</dd></div>
            <div><dt>Period</dt><dd>{visits.length ? `${fmtDate(visits[0].visit_date, { weekday: false })} – ${fmtDate(visits[visits.length - 1].visit_date, { weekday: false })}` : "—"}</dd></div>
            <div><dt>Findings</dt><dd>{findings.length}</dd></div>
            <div className="st-open"><dt>Open</dt><dd>{site.open_count}</dd></div>
            <div className="st-closed"><dt>Closed</dt><dd>{site.fixed_count}</dd></div>
          </dl>
        </header>
        {!findings.length && !editing ? (
          <div className="gap-empty">
            <p>No findings at this branch yet.</p>
            {canReport && <button type="button" className="btn sm gap-noprint" onClick={begin}>Submit report for {insp!.code}</button>}
          </div>
        ) : (
          <>
            <div className="gap-w">
              <table className={`gap${editing ? " editing" : ""}`}>
                <thead>
                  <tr>
                    <th>S.No</th><th>Department</th><th>Location</th><th className="wide">Observation</th><th>Pictorial view</th>
                    <th className="wide">Risk</th><th className="wide">Recommendation</th>
                    <th className="gv">Gap found date</th>
                    <th className="gv">Fix date</th>
                    {editing && <th className="gv now">This visit<small>{date ? fmtDate(date, { weekday: false }) : "—"}</small></th>}
                    <th>Gap classification<small className="sev">Low, Moderate, High, Severe</small></th>
                    <th>Responsibility</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((sec) => (
                    <Fragment key={sec.key}>
                      <tr className="gap-cat">
                        <td colSpan={cols}>
                          {FINDING_CATEGORY[sec.key]}
                          {editing && <button type="button" className="cat-add gap-noprint" onClick={() => addDraft(sec.key)}>+ Add finding</button>}
                        </td>
                      </tr>
                      {sec.rows.map((f) => {
                        const ph = photos(f.id);
                        const c = checks[f.id];
                        return (
                          <tr key={f.id} className={`${f.status === "fixed" ? "done" : ""}${c?.result ? " touched" : ""}`}>
                            <td className="c">{++n}<button type="button" className="lnk code" onClick={() => ctx.open({ t: "finding", id: f.id })}>{f.code}</button></td>
                            <td>{f.department || "—"}</td>
                            <td><b>{f.area || "—"}</b></td>
                            <td><span className="pre">{f.description}</span></td>
                            <td className="pv">{ph.length ? <Photos files={ph} label={`Pictorial view ${f.code}`} /> : <span className="muted">—</span>}</td>
                            <td><span className="pre">{f.risk || "—"}</span></td>
                            <td><span className="pre">{f.recommendation || "—"}</span></td>
                            <td className="gv">
                              <button type="button" className="lnk" title={`Open visit ${f.found_visit_code}`} onClick={() => ctx.open({ t: "visit", id: f.found_visit_id })}>
                                {fmtDate(f.found_on, { weekday: false })}
                              </button>
                            </td>
                            <td className="gv">
                              {f.status === "fixed" && f.fixed_on ? (
                                <>
                                  {f.fixed_visit_id ? (
                                    <button type="button" className="lnk" title="Open the visit it was fixed on" onClick={() => ctx.open({ t: "visit", id: f.fixed_visit_id! })}>
                                      {fmtDate(f.fixed_on, { weekday: false })}
                                    </button>
                                  ) : fmtDate(f.fixed_on, { weekday: false })}
                                  {fixNote(f) && <small className="pre">{fixNote(f)}</small>}
                                </>
                              ) : (
                                <>
                                  <span className="gs open">Open</span>
                                  {stillOpen.has(f.id) && (() => {
                                    const c = stillOpen.get(f.id)!;
                                    return (
                                      <small className="pre">
                                        Not fixed {fmtDate(c.visit_date, { weekday: false, year: false })}{f.times_not_fixed > 1 ? ` (${f.times_not_fixed}×)` : ""}
                                        {c.note ? `: ${c.note}` : ""}
                                      </small>
                                    );
                                  })()}
                                </>
                              )}
                            </td>
                            {editing && (
                              <td className="gv now">
                                {f.status === "fixed" ? null : !checkable(f) ? <small>Found after this date</small> : (
                                  <>
                                    <div className="gx" role="group" aria-label={`${f.code} on this visit`}>
                                      <button type="button" className="open" aria-pressed={c?.result === "not_fixed"} onClick={() => toggle(f.id, "not_fixed")}>Open</button>
                                      <button type="button" className="closed" aria-pressed={c?.result === "fixed"} onClick={() => toggle(f.id, "fixed")}>Closed</button>
                                    </div>
                                    {c?.result && (
                                      <textarea className="ci note" aria-label={`Note on ${f.code}`} value={c.note} maxLength={2000} rows={2}
                                        onChange={(e) => setCheck(f.id, { note: e.target.value })}
                                        placeholder={c.result === "fixed" ? "What was done" : "What is still wrong"} />
                                    )}
                                  </>
                                )}
                              </td>
                            )}
                            <td className="c"><span className={`bdg ${GAP_CLASS[f.severity]?.tone ?? "gray"}`}>{GAP_CLASS[f.severity]?.label ?? f.severity}</span></td>
                            <td>{f.responsibility ? RESPONSIBILITY[f.responsibility] ?? f.responsibility : "—"}</td>
                          </tr>
                        );
                      })}
                      {sec.drafts.map((d) => (
                        <tr key={d.key} className="draft">
                          <td className="c">
                            <span className="gs new">New</span>
                            <button type="button" className="lnk code" onClick={() => setDrafts((l) => l.filter((x) => x.key !== d.key))}>Remove</button>
                          </td>
                          <td><input className="ci" aria-label="Department" placeholder="Department" value={d.department} maxLength={200} onChange={(e) => editDraft(d.key, { department: e.target.value })} /></td>
                          <td><input className="ci" aria-label="Location" placeholder="Location" value={d.area} maxLength={200} onChange={(e) => editDraft(d.key, { area: e.target.value })} /></td>
                          <td>
                            <textarea className={`ci${bad[`d${d.key}`] ? " bad" : ""}`} aria-label="Observation" placeholder="Observation *" value={d.description} maxLength={2000}
                              onChange={(e) => editDraft(d.key, { description: e.target.value })} />
                            {bad[`d${d.key}`] && <small className="ferr">{bad[`d${d.key}`]}</small>}
                          </td>
                          <td className="pv"><MiniPhotos files={d.files} onChange={(l) => editDraft(d.key, { files: l })} label="pictorial view" /></td>
                          <td><textarea className="ci" aria-label="Risk" placeholder="Risk" value={d.risk} maxLength={1000} onChange={(e) => editDraft(d.key, { risk: e.target.value })} /></td>
                          <td><textarea className="ci" aria-label="Recommendation" placeholder="Recommendation" value={d.recommendation} maxLength={1000} onChange={(e) => editDraft(d.key, { recommendation: e.target.value })} /></td>
                          <td className="gv">{date ? fmtDate(date, { weekday: false }) : "—"}</td>
                          <td className="gv"><span className="gs open">Open</span></td>
                          <td className="gv now"><span className="gs new">New</span></td>
                          <td className="c">
                            <select className="ci" aria-label="Gap classification" value={d.severity} onChange={(e) => editDraft(d.key, { severity: e.target.value })}>
                              {Object.entries(GAP_CLASS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="ci" aria-label="Responsibility" value={d.responsibility} onChange={(e) => editDraft(d.key, { responsibility: e.target.value })}>
                              <option value="">Not set</option>
                              {Object.entries(RESPONSIBILITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {editing && (
                    <tr className="gap-addrow gap-noprint">
                      <td colSpan={cols}>
                        <span>Add a finding to</span>
                        <select className="ci" aria-label="Section" value={addCat} onChange={(e) => setAddCat(e.target.value)}>
                          {FINDING_CATEGORY_ORDER.map((k) => <option key={k} value={k}>{FINDING_CATEGORY[k]}</option>)}
                        </select>
                        <button type="button" className="btn alt sm" onClick={() => addDraft(addCat)}>+ Add finding</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!editing && (
              <p className="note gap-legend">
                <b>Gap found date</b> visit the gap was first recorded · <b>Fix date</b> visit it was closed, or <span className="gs open">Open</span> if not fixed yet
              </p>
            )}
          </>
        )}
        {!editing && visits.length > 0 && (
          <section className="gap-log" aria-label="Visit log">
            <h4>Visit log</h4>
            <div className="gap-w">
              <table className="gap">
                <thead>
                  <tr><th>Visit</th><th>Date</th><th>By</th><th>Pest activity</th><th>Findings</th><th className="wide">Notes</th></tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id}>
                      <td className="c"><button type="button" className="lnk" onClick={() => ctx.open({ t: "visit", id: v.id })}>{v.code}</button></td>
                      <td className="c">{fmtDate(v.visit_date, { weekday: false })}</td>
                      <td>{v.created_by === ctx.userId ? "You" : v.created_by_name}</td>
                      <td className="c">{v.pest_activity ? PEST_ACTIVITY[v.pest_activity] ?? v.pest_activity : "—"}</td>
                      <td>{visitSummary(v)}</td>
                      <td><span className="pre">{v.notes || "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {editing && (
        <div className="gap-bar gap-noprint" role="region" aria-label="Submit report">
          <span className="gb-s">
            {[nClosed ? `${nClosed} closed` : "", marked.length - nClosed ? `${marked.length - nClosed} still open` : "", drafts.length ? `${drafts.length} new` : ""]
              .filter(Boolean).join(" · ") || "Nothing marked yet"}
          </span>
          {err && <span className="gb-e" role="alert">{err}</span>}
          <button type="button" className="btn alt sm" disabled={saving} onClick={reset}>Cancel</button>
          <button type="button" className="btn sm" disabled={saving} onClick={save}>{saving ? "Submitting…" : "Submit report"}</button>
        </div>
      )}
    </>
  );
}

/* ---------- Lists ---------- */
const LIST_PAGE = 20;
const JOB_LISTS: ListKind[] = ["pending", "verified", "complaint"];

function ListPanel({ kind: initial, ctx }: { kind: ListKind; ctx: Ctx }) {
  const isJobs = JOB_LISTS.includes(initial);
  const [jobStatus, setJobStatus] = useState<string>(isJobs ? initial : "pending");
  const [filter, setFilter] = useState(initial === "meetings" ? "upcoming" : initial === "inspections" ? "assigned" : "open");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(LIST_PAGE);
  const kind = isJobs ? "jobs" : initial;
  const { setTitle } = ctx;
  useEffect(() => { setTitle(isJobs ? LIST_TITLE[jobStatus as ListKind] : LIST_TITLE[initial]); }, [isJobs, jobStatus, initial, setTitle]);
  useEffect(() => {
    const h = setTimeout(() => { setTerm(search.replace(/[^\p{L}\p{N}\s\-_.]/gu, " ").trim()); setLimit(LIST_PAGE); }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const q = useQuery(async () => {
    const db = ento();
    const uid = ctx.userId;
    const like = term ? `%${term}%` : "";
    if (kind === "jobs") {
      let b = db.from("v_jobs").select("visit_id,job_code,kind,visit_date,site_name,client_name,pco_name,completed_at,verification_status,round,last_issue", { count: "exact" })
        .eq("verification_status", jobStatus);
      if (like) b = b.or(`job_code.ilike.${like},site_name.ilike.${like},client_name.ilike.${like},pco_name.ilike.${like}`);
      const r = await b.order("completed_at", { ascending: jobStatus === "pending" }).range(0, limit - 1);
      return { rows: must(r) as JobRow[], count: r.count ?? 0 };
    }
    if (kind === "complaints") {
      let b = db.from("v_complaints").select("*", { count: "exact" }).eq("created_by", uid);
      if (filter === "open") b = b.in("status", COMPLAINT_OPEN); else if (filter !== "all") b = b.eq("status", filter);
      if (like) b = b.or(`code.ilike.${like},description.ilike.${like},site_name.ilike.${like},client_name.ilike.${like},job_code.ilike.${like}`);
      const r = await b.order("created_at", { ascending: false }).range(0, limit - 1);
      return { rows: must(r) as ComplaintRow[], count: r.count ?? 0 };
    }
    if (kind === "inspections") {
      let b = db.from("v_inspection_tasks").select("*", { count: "exact" }).eq("assigned_to", uid).eq("status", filter);
      if (like) b = b.or(`code.ilike.${like},purpose.ilike.${like},site_name.ilike.${like},client_name.ilike.${like}`);
      const r = await b.order("inspection_date", { ascending: filter === "assigned" }).range(0, limit - 1);
      return { rows: must(r) as InspectionTaskRow[], count: r.count ?? 0 };
    }
    if (kind === "meetings") {
      const now = isoHoursAgo(0), cut = isoHoursAgo(1);
      let b = db.from("v_my_meetings").select("*", { count: "exact" });
      b = filter === "upcoming"
        ? b.or(`ends_at.gte.${now},and(ends_at.is.null,starts_at.gte.${cut})`).order("starts_at")
        : b.or(`ends_at.lt.${now},and(ends_at.is.null,starts_at.lt.${cut})`).order("starts_at", { ascending: false });
      const r = await b.range(0, limit - 1);
      return { rows: must(r) as MeetingRow[], count: r.count ?? 0 };
    }
    const r = await db.from("notifications").select("*", { count: "exact" }).eq("assigned_to", uid).order("created_at", { ascending: false }).range(0, limit - 1);
    return { rows: must(r) as NotificationRow[], count: r.count ?? 0 };
  }, [kind, jobStatus, filter, term, limit, ctx.userId]);

  const rows = q.data?.rows ?? [];
  return (
    <>
      {isJobs && (
        <Seg value={jobStatus} onChange={(v) => { setJobStatus(v); setLimit(LIST_PAGE); }} label="Verification status"
          items={[["pending", "Pending"], ["verified", "Verified"], ["complaint", "Complaint"]]} />
      )}
      {kind === "complaints" && (
        <Seg value={filter} onChange={(v) => { setFilter(v); setLimit(LIST_PAGE); }} label="Complaint status" items={[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]]} />
      )}
      {kind === "inspections" && (
        <Seg value={filter} onChange={(v) => { setFilter(v); setLimit(LIST_PAGE); }} label="Inspections" items={[["assigned", "Report due"], ["submitted", "Submitted"]]} />
      )}
      {kind === "meetings" && (
        <Seg value={filter} onChange={(v) => { setFilter(v); setLimit(LIST_PAGE); }} label="Meetings" items={[["upcoming", "Upcoming"], ["past", "Past"]]} />
      )}
      {kind === "notifications" && rows.some((n) => !(n as NotificationRow).read_at) && (
        <div className="row"><button type="button" className="btn alt sm" onClick={async () => { await markNotificationsRead(); q.reload(); }}>Mark all read</button></div>
      )}
      {(kind === "jobs" || kind === "complaints" || kind === "inspections") && (
        <div className="fld"><input type="search" aria-label="Search" placeholder="Search code, site, client…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      )}
      {q.error && <Err m={q.error} />}
      {!q.data && q.loading ? <Loading /> : (
        <section className="issues">
          {!rows.length && <p className="empty">Nothing here.</p>}
          {kind === "jobs" && (rows as JobRow[]).map((j) => (
            <Row key={j.visit_id} onClick={() => ctx.open({ t: "job", id: j.visit_id })}
              title={`${j.site_name} · ${j.job_code ?? ""}`}
              sub={`${j.client_name} · ${JOB_KIND[j.kind]} ${fmtDate(j.visit_date, { year: false })}${j.pco_name ? ` · ${j.pco_name}` : ""} · done ${fmtAgo(j.completed_at!)}`}
              badge={<JobBadge j={j} />} />
          ))}
          {kind === "complaints" && (rows as ComplaintRow[]).map((c) => (
            <Row key={c.id} onClick={() => ctx.open({ t: "complaint", id: c.id })} title={`${c.code} · ${c.site_name}`}
              sub={`${COMPLAINT_ISSUE[c.issue]?.label ?? c.issue} · ${c.job_code} · ${fmtDate(karachiYmd(c.created_at), { year: false })}`}
              badge={<Bdg s={COMPLAINT_STATUS[c.status]} />} />
          ))}
          {kind === "inspections" && (rows as InspectionTaskRow[]).map((t) => (
            <Row key={t.id} onClick={() => ctx.open({ t: "inspection", id: t.id })} title={`${t.code} · ${t.site_name}`}
              sub={`${fmtDate(t.inspection_date, { year: false })} ${t.inspection_time} · ${t.purpose}`}
              badge={<Bdg s={INSPECTION_STATUS[t.status]} />} />
          ))}
          {kind === "meetings" && (rows as MeetingRow[]).map((m) => (
            <Row key={m.id} onClick={() => ctx.open({ t: "meeting", id: m.id })} title={m.title}
              sub={`${fmtDateTime(m.starts_at)} · ${m.location || "Online"}`}
              badge={m.status === "cancelled" ? <Bdg s={MEETING_STATUS.cancelled} /> : filter === "past" ? <span className="bdg gray">{ATTENDANCE[m.attendance]}</span> : <Bdg s={RSVP[m.rsvp]} />} />
          ))}
          {kind === "notifications" && (rows as NotificationRow[]).map((n) => (
            <button key={n.id} type="button" className={`nt${n.read_at ? "" : " unread"}`}
              onClick={() => {
                if (!n.read_at) markNotificationsRead([n.id]);
                const p = panelFromLink(n.link);
                if (p) ctx.open(p);
              }}>
              <i aria-hidden="true" />
              <span style={{ minWidth: 0 }}><b>{n.title}</b>{n.body && <p>{n.body}</p>}<small>{fmtAgo(n.created_at)}</small></span>
            </button>
          ))}
        </section>
      )}
      {q.data && q.data.count > limit && (
        <div className="row"><button type="button" className="btn alt sm" onClick={() => setLimit((l) => l + LIST_PAGE)}>Show more ({q.data.count - limit} left)</button></div>
      )}
    </>
  );
}
