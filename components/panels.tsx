"use client";

/**
 * Everything that opens in the planner's slide-in drawer: a job (with Verify / Reject /
 * Request Revisit / Lodge Complaint), a complaint, a request, a meeting, a site report,
 * lists (pending jobs, complaints, requests, meetings, notifications) and the new
 * complaint / request forms. The page itself never changes — like the Operations planner.
 */
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ento, must, opsDb, useQuery, useSigned } from "@/lib/client-data";
import { markNotificationsRead } from "@/app/actions";
import { CancelRequestButton, CommentForm, ComplaintForm, MeetingResponse, RequestForm, RevisitForm, VerifyForm } from "./forms";
import { Photos } from "./Photos";
import {
  ATTENDANCE, COMPLAINT_CATEGORY, COMPLAINT_FLOW, COMPLAINT_OPEN, COMPLAINT_STATUS, JOB_KIND, MEETING_STATUS,
  OUTCOME, PRIORITY, REQUEST_OPEN, REQUEST_STATUS, REQUEST_TYPE, RSVP, VERIFICATION, VISIT_STATUS, type Tone,
} from "@/lib/labels";
import { dayParts, fmtAgo, fmtDate, fmtDateTime, isoHoursAgo, karachiHm, karachiYmd } from "@/lib/time";
import type {
  AttachmentRow, ComplaintRow, ComplaintUpdateRow, InspectionRow, JobRow, MeetingRow, NotificationRow, RequestRow, SignedFile, SiteRow, VerificationRow,
} from "@/lib/types";

/* ---------- panel addresses ---------- */
export type ListKind = "pending" | "verified" | "rejected" | "revisit_requested" | "complaints" | "requests" | "meetings" | "notifications";
export type Panel =
  | { t: "job" | "complaint" | "request" | "meeting" | "site"; id: string }
  | { t: "list"; id: ListKind }
  | { t: "new-complaint"; site?: string; job?: string }
  | { t: "new-request"; kind: "revisit" | "inspection"; site?: string; job?: string };

const IDT = ["job", "complaint", "request", "meeting", "site", "list"];
/** Panel ↔ "?open=" value, so a refresh or a notification link reopens the same drawer. */
export function encodePanel(p: Panel | undefined): string {
  return p && "id" in p && IDT.includes(p.t) ? `${p.t}_${p.id}` : "";
}
export function decodePanel(s: string | null): Panel | null {
  const m = /^(job|complaint|request|meeting|site|list)_([\w-]{3,40})$/.exec(s ?? "");
  return m ? ({ t: m[1], id: m[2] } as Panel) : null;
}
/** Notification links are stored as portal paths ("/jobs/<id>"); map them to panels. */
export function panelFromLink(link: string | null): Panel | null {
  const m = /^\/(jobs|complaints|requests|meetings|sites)\/([0-9a-f-]{36})$/.exec(link ?? "");
  if (!m) return null;
  const t = ({ jobs: "job", complaints: "complaint", requests: "request", meetings: "meeting", sites: "site" } as const)[m[1] as "jobs"];
  return { t, id: m[2] };
}

export const LIST_TITLE: Record<ListKind, string> = {
  pending: "Pending verification", verified: "Verified jobs", rejected: "Rejected jobs", revisit_requested: "Revisit requested",
  complaints: "Complaints", requests: "Revisit & inspection requests", meetings: "Meetings", notifications: "Notifications",
};
export function defaultTitle(p: Panel): string {
  switch (p.t) {
    case "list": return LIST_TITLE[p.id];
    case "new-complaint": return "Lodge complaint";
    case "new-request": return p.kind === "revisit" ? "Send revisit" : "Request inspection";
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
    case "request": return <RequestPanel id={panel.id} ctx={ctx} />;
    case "meeting": return <MeetingPanel id={panel.id} ctx={ctx} />;
    case "site": return <SitePanel id={panel.id} ctx={ctx} />;
    case "list": return <ListPanel kind={panel.id} ctx={ctx} />;
    case "new-complaint": return <NewPanel panel={panel} ctx={ctx} />;
    case "new-request": return <NewPanel panel={panel} ctx={ctx} />;
  }
}

/* ---------- Job: same layout as the Operations visit drawer (card · tabs · pane) ---------- */
const DECISION: Record<string, string> = { verified: "Verified", rejected: "Rejected", revisit_requested: "Revisit requested" };

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
  const [tab, setTab] = useState<"report" | "verify" | "revisit">("report");

  if (q.error && !q.data) return <Err m={`Could not load this job: ${q.error}`} />;
  if (!q.data && q.loading) return <Loading />;
  if (!j) return <p className="empty">Job not found.</p>;

  const file = (p: string) => files.find((f) => f.path === p);
  const verifs = q.data!.verifs;
  const last = verifs[verifs.length - 1];
  const statusBadge = j.verification_status
    ? <Bdg s={j.verification_status === "pending" ? { label: "Needs verification", tone: "red" } : VERIFICATION[j.verification_status]} />
    : j.visit_status === "started" ? <Bdg s={VISIT_STATUS.started} /> : null;
  const done = () => { q.reload(); ctx.changed(); };

  return (
    <>
      {j.return_note && pending && <p className="hint">Returned for re-verification (round {j.round}): {j.return_note}</p>}
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
            {([["report", "Report"], ["verify", "Verify"], ["revisit", "Revisit"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "report" && <ServiceReport j={j} file={file} />}
          {tab === "verify" && <VerifyForm assignmentId={j.assignment_id!} siteId={j.site_id} visitId={j.visit_id} onDone={done} />}
          {tab === "revisit" && <RevisitForm sites={ctx.sites} fixed={{ siteId: j.site_id, visitId: j.visit_id, label: "" }} onDone={done} />}
        </>
      ) : (
        <>
          {/* Decided jobs are locked: the final decision and the job's history only (no report). */}
          {last && (
            <div className="rep">
              <h4>Final decision <Bdg s={VERIFICATION[j.verification_status ?? last.decision]} /></h4>
              <dl className="kv">
                <dt>Decision</dt><dd>{DECISION[last.decision] ?? last.decision}</dd>
                <dt>By</dt><dd>{last.created_by === ctx.userId ? "You" : last.verifier_name}</dd>
                <dt>On</dt><dd>{fmtDateTime(last.created_at)}</dd>
                {(last.remarks || last.reason) && <><dt>Note</dt><dd className="pre">{last.reason ?? last.remarks}</dd></>}
              </dl>
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
  for (const v of verifs) {
    steps.push({
      title: `${DECISION[v.decision] ?? v.decision}${verifs.length > 1 ? ` (round ${v.round})` : ""}`,
      meta: `${v.created_by === userId ? "You" : v.verifier_name} · ${fmtDateTime(v.created_at)}`,
      body: v.reason ?? v.remarks,
      cls: v.decision === "verified" ? "on" : "bad",
    });
  }
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
        line={`${COMPLAINT_CATEGORY[c.category]} · ${PRIORITY[c.priority]?.label} priority`}
        color="var(--red)"
        rows={[
          ["Complaint", c.code],
          ["Site", <LinkBtn key="s" onClick={() => ctx.open({ t: "site", id: c.site_id })}>{c.site_name}, {c.client_name}</LinkBtn>],
          ["Job", c.visit_id ? <LinkBtn key="j" onClick={() => ctx.open({ t: "job", id: c.visit_id! })}>{c.job_code} · {fmtDate(c.job_date)}</LinkBtn> : "—"],
          ["Submitted", fmtDateTime(c.created_at)],
          ["Description", <span key="d" className="pre">{c.description}</span>],
        ]}
      />
      {files.length > 0 && <div className="rep"><h4>Photos</h4><Photos files={files} label="Complaint photos" /></div>}
      <div className="rep">
        <h4>Status</h4>
        <ol className="tl">
          {COMPLAINT_FLOW.map((s, i) => <li key={s} className={i <= reached ? "on" : "todo"}>{COMPLAINT_STATUS[s].label}</li>)}
        </ol>
      </div>
      <div className="rep">
        <h4>Updates from Admin / Operations</h4>
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
      {c.status !== "closed" && <CommentForm complaintId={c.id} onDone={q.reload} />}
    </>
  );
}

/* ---------- Request (revisit / inspection) ---------- */
function RequestPanel({ id, ctx }: { id: string; ctx: Ctx }) {
  const q = useQuery(async () => {
    const db = ento();
    const r = must(await db.from("v_requests").select("*").eq("id", id).maybeSingle()) as RequestRow | null;
    if (!r) return null;
    const atts = must(await db.from("attachments").select("*").eq("entity_type", "activity_request").eq("entity_id", id)) as AttachmentRow[];
    return { r, atts };
  }, [id]);
  const r = q.data?.r;
  const { setTitle } = ctx;
  useEffect(() => { if (r) setTitle(`${REQUEST_TYPE[r.type]} ${r.code}`); }, [r, setTitle]);
  const atts = q.data?.atts ?? [];
  const files = useSigned("ento-files", atts.map((a) => a.path), Object.fromEntries(atts.map((a) => [a.path, a.file_name])));

  if (q.error && !q.data) return <Err m={q.error} />;
  if (!q.data && q.loading) return <Loading />;
  if (!r) return <p className="empty">Request not found.</p>;

  const rejected = r.status === "rejected";
  const scheduled = r.status === "scheduled" || r.status === "completed";
  const steps: { title: string; meta?: string | null; body?: string | null; cls: string }[] = [
    { title: "Submitted", meta: `${fmtDateTime(r.created_at)}`, cls: "on" },
    r.status === "cancelled"
      ? { title: "Withdrawn", meta: fmtDateTime(r.updated_at), body: r.decision_note, cls: "bad" }
      : r.status === "submitted"
        ? { title: "Waiting for Admin to approve or reject", cls: "todo" }
        : { title: rejected ? "Rejected by Admin" : "Approved by Admin", meta: `${r.decided_by_name ?? "Admin"} · ${fmtDateTime(r.decided_at)}`, body: r.decision_note, cls: rejected ? "bad" : "on" },
  ];
  if (!rejected && r.status !== "cancelled") {
    steps.push(scheduled
      ? { title: `Scheduled ${fmtDate(r.scheduled_date)} · ${r.scheduled_time}`, meta: [r.scheduled_job_code, r.pco_name ? `PCO ${r.pco_name}` : "PCO being assigned by Operations"].filter(Boolean).join(" · "), cls: "on" }
      : { title: "Admin sets the date and assigns the PCO", cls: "todo" });
    steps.push({ title: "Completed", meta: r.status !== "completed" && r.scheduled_visit_status ? `Visit: ${VISIT_STATUS[r.scheduled_visit_status]?.label}` : null, cls: r.status === "completed" ? "on" : "todo" });
  }

  return (
    <>
      <Card
        date={r.scheduled_date ?? r.recommended_date} time={r.scheduled_time} title={r.site_name}
        badge={<Bdg s={REQUEST_STATUS[r.status]} />}
        company={r.client_name}
        line={`${REQUEST_TYPE[r.type]} · ${r.pco_name ?? "PCO not assigned"}`}
        color={r.type === "revisit" ? "var(--t-rev)" : "var(--t-insp)"}
        rows={[
          ["Request", `${r.code} · ${PRIORITY[r.priority]?.label} priority`],
          ["Site", <LinkBtn key="s" onClick={() => ctx.open({ t: "site", id: r.site_id })}>{r.site_name}, {r.client_name}</LinkBtn>],
          ["Job", r.visit_id ? <LinkBtn key="j" onClick={() => ctx.open({ t: "job", id: r.visit_id! })}>{r.prev_job_code} · {fmtDate(r.prev_visit_date)}</LinkBtn> : "—"],
          [r.type === "revisit" ? "Reason" : "Purpose", r.reason ?? r.purpose],
          ["Recommended", fmtDate(r.recommended_date)],
          [r.type === "revisit" ? "Problem" : "Observations", <span key="d" className="pre">{r.description}</span>],
        ]}
      />
      {files.length > 0 && <div className="rep"><h4>Supporting photos</h4><Photos files={files} label="Request photos" /></div>}
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
        {r.status === "submitted" && r.created_by === ctx.userId && (
          <div className="row"><CancelRequestButton id={r.id} onDone={() => { q.reload(); ctx.changed(); }} /></div>
        )}
      </div>
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
  const [tab, setTab] = useState<"jobs" | "inspections" | "requests" | "complaints">("jobs");
  const [kind, setKind] = useState("");
  const [limit, setLimit] = useState(SITE_PAGE);
  const site = ctx.sites.find((s) => s.site_id === id);
  const { setTitle } = ctx;
  useEffect(() => { if (site) setTitle(site.site_name); }, [site, setTitle]);

  const head = useQuery(async () => {
    const db = ento();
    const c = { count: "exact" as const, head: true };
    const [jobs, ver, rej, pend, issues] = await Promise.all([
      db.from("v_jobs").select("visit_id", c).eq("site_id", id).not("verification_status", "is", null),
      db.from("job_assignments").select("id", c).eq("site_id", id).eq("verification_status", "verified"),
      db.from("job_assignments").select("id", c).eq("site_id", id).eq("verification_status", "rejected"),
      db.from("job_assignments").select("id", c).eq("site_id", id).eq("verification_status", "pending"),
      opsDb().from("site_issues").select("id,description,created_at").eq("site_id", id).eq("open", true).order("created_at", { ascending: false }),
    ]);
    return { jobs: jobs.count ?? 0, ver: ver.count ?? 0, rej: rej.count ?? 0, pend: pend.count ?? 0, issues: must(issues) as { id: string; description: string }[] };
  }, [id]);

  const list = useQuery(async () => {
    const db = ento();
    if (tab === "jobs") {
      let b = db.from("v_jobs").select("visit_id,job_code,kind,visit_status,visit_date,pco_name,items,findings,verification_status,last_verifier_name", { count: "exact" }).eq("site_id", id).not("verification_status", "is", null);
      if (kind) b = b.eq("kind", kind);
      const r = await b.order("visit_date", { ascending: false }).range(0, limit - 1);
      return { rows: must(r) as JobRow[], count: r.count ?? 0 };
    }
    if (tab === "inspections") return { rows: must(await db.from("v_inspections").select("*").eq("site_id", id).order("visit_date", { ascending: false }).limit(100)) as InspectionRow[], count: 0 };
    if (tab === "requests") return { rows: must(await db.from("v_requests").select("*").eq("site_id", id).order("created_at", { ascending: false }).limit(100)) as RequestRow[], count: 0 };
    const [mine, opsC] = await Promise.all([
      db.from("v_complaints").select("*").eq("site_id", id).order("created_at", { ascending: false }).limit(100),
      opsDb().from("complaints").select("id,code,description,severity,status,lodged_by_name,lodged_at").eq("site_id", id).order("lodged_at", { ascending: false }).limit(100),
    ]);
    return { rows: must(mine) as ComplaintRow[], ops: must(opsC) as { id: string; code: string; description: string; severity: string; status: string; lodged_by_name: string; lodged_at: string }[], count: 0 };
  }, [id, tab, kind, limit]);

  if (!site) return <p className="empty">Site not found.</p>;
  const h = head.data;

  return (
    <>
      <section className="sitecard">
        <div className="sc-t"><b>{site.site_name}</b><span>{site.client_name}{site.city ? ` · ${site.city}` : ""}</span></div>
        <div className="stats">
          <span><b>{h?.pend ?? "–"}</b>pending</span>
          <span><b>{h?.ver ?? "–"}</b>verified</span>
          <span><b>{h?.rej ?? "–"}</b>rejected</span>
        </div>
        <div className="acts">
          <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "new-complaint", site: id })}>Lodge complaint</button>
          <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "new-request", kind: "inspection", site: id })}>Request inspection</button>
        </div>
      </section>
      {h && h.issues.length > 0 && (
        <section className="issues">
          <h3>Open site findings</h3>
          <ul>{h.issues.map((i) => <li key={i.id}><span>{i.description}</span></li>)}</ul>
        </section>
      )}
      <Seg value={tab} onChange={(v) => { setTab(v); setLimit(SITE_PAGE); }} label="Site report" items={[["jobs", `Jobs${h ? ` ${h.jobs}` : ""}`], ["inspections", "Inspections"], ["requests", "Requests"], ["complaints", "Complaints"]]} />
      {tab === "jobs" && (
        <div className="fld">
          <select aria-label="Job type" value={kind} onChange={(e) => { setKind(e.target.value); setLimit(SITE_PAGE); }}>
            <option value="">All job types</option>
            {["monthly", "contract", "revisit"].map((k) => <option key={k} value={k}>{JOB_KIND[k]}</option>)}
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
              badge={j.verification_status ? <Bdg s={VERIFICATION[j.verification_status]} /> : <Bdg s={VISIT_STATUS[j.visit_status]} />} />
          )) : <p className="empty">No jobs.</p>)}
          {tab === "inspections" && ((list.data.rows as InspectionRow[]).length ? (list.data.rows as InspectionRow[]).map((i) => (
            <div key={i.visit_id} className="r2">
              <b>{fmtDate(i.visit_date)} · Inspection</b>
              <small>{i.activity ? `Pest activity ${i.activity} · ${i.advice} · ${i.areas}` : i.note ?? "No report yet"}</small>
              <Bdg s={VISIT_STATUS[i.visit_status]} />
            </div>
          )) : <p className="empty">No inspections.</p>)}
          {tab === "requests" && ((list.data.rows as RequestRow[]).length ? (list.data.rows as RequestRow[]).map((r) => (
            <Row key={r.id} onClick={() => ctx.open({ t: "request", id: r.id })} title={`${r.code} · ${REQUEST_TYPE[r.type]}`}
              sub={`${fmtDate(r.scheduled_date ?? r.recommended_date)} · ${r.reason ?? r.purpose}`} badge={<Bdg s={REQUEST_STATUS[r.status]} />} />
          )) : <p className="empty">No requests.</p>)}
          {tab === "complaints" && (
            <>
              {(list.data.rows as ComplaintRow[]).map((c) => (
                <Row key={c.id} onClick={() => ctx.open({ t: "complaint", id: c.id })} title={`${c.code} · ${COMPLAINT_CATEGORY[c.category]}`}
                  sub={`${fmtDate(karachiYmd(c.created_at))} · ${c.description}`} badge={<Bdg s={COMPLAINT_STATUS[c.status]} />} />
              ))}
              {(list.data.ops ?? []).map((c) => (
                <div key={c.id} className="r2">
                  <b>{c.code} · client complaint ({c.severity})</b>
                  <small>{fmtDate(karachiYmd(c.lodged_at))} · {c.lodged_by_name} · {c.description}</small>
                  <span className={`bdg ${c.status === "resolved" || c.status === "closed" ? "green" : "amber"}`}>{c.status === "open" ? "With Admin" : c.status.replace("_", " ")}</span>
                </div>
              ))}
              {!list.data.rows.length && !(list.data.ops ?? []).length && <p className="empty">No complaints.</p>}
            </>
          )}
        </section>
      )}
      {tab === "jobs" && list.data && list.data.count > limit && (
        <div className="row"><button type="button" className="btn alt sm" onClick={() => setLimit((l) => l + SITE_PAGE)}>Show more ({list.data.count - limit} left)</button></div>
      )}
      <p className="note">PCO reports are read-only here. Corrections are made by Operations and earlier versions are kept.</p>
    </>
  );
}

/* ---------- Lists ---------- */
const LIST_PAGE = 20;
const JOB_LISTS: ListKind[] = ["pending", "verified", "rejected", "revisit_requested"];

function ListPanel({ kind: initial, ctx }: { kind: ListKind; ctx: Ctx }) {
  const isJobs = JOB_LISTS.includes(initial);
  const [jobStatus, setJobStatus] = useState<string>(isJobs ? initial : "pending");
  const [filter, setFilter] = useState(initial === "meetings" ? "upcoming" : "open");
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
      let b = db.from("v_jobs").select("visit_id,job_code,kind,visit_date,site_name,client_name,pco_name,completed_at,verification_status,round", { count: "exact" })
        .eq("verification_status", jobStatus);
      if (like) b = b.or(`job_code.ilike.${like},site_name.ilike.${like},client_name.ilike.${like},pco_name.ilike.${like}`);
      const r = await b.order("completed_at", { ascending: jobStatus === "pending" }).range(0, limit - 1);
      return { rows: must(r) as JobRow[], count: r.count ?? 0 };
    }
    if (kind === "complaints") {
      let b = db.from("v_complaints").select("*", { count: "exact" }).eq("created_by", uid);
      if (filter === "open") b = b.in("status", COMPLAINT_OPEN); else if (filter !== "all") b = b.eq("status", filter);
      if (like) b = b.or(`code.ilike.${like},description.ilike.${like},site_name.ilike.${like},client_name.ilike.${like}`);
      const r = await b.order("created_at", { ascending: false }).range(0, limit - 1);
      return { rows: must(r) as ComplaintRow[], count: r.count ?? 0 };
    }
    if (kind === "requests") {
      let b = db.from("v_requests").select("*", { count: "exact" }).eq("created_by", uid);
      if (filter === "open") b = b.in("status", REQUEST_OPEN);
      else if (filter === "rejected") b = b.in("status", ["rejected", "cancelled"]);
      else if (filter !== "all") b = b.eq("status", filter);
      if (like) b = b.or(`code.ilike.${like},description.ilike.${like},site_name.ilike.${like},reason.ilike.${like},purpose.ilike.${like}`);
      const r = await b.order("created_at", { ascending: false }).range(0, limit - 1);
      return { rows: must(r) as RequestRow[], count: r.count ?? 0 };
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
          items={[["pending", "Pending"], ["verified", "Verified"], ["rejected", "Rejected"], ["revisit_requested", "Revisit"]]} />
      )}
      {kind === "complaints" && (
        <>
          <div className="row"><button type="button" className="btn sm" onClick={() => ctx.open({ t: "new-complaint" })}>Lodge complaint</button></div>
          <Seg value={filter} onChange={(v) => { setFilter(v); setLimit(LIST_PAGE); }} label="Complaint status" items={[["open", "Open"], ["resolved", "Resolved"], ["closed", "Closed"], ["all", "All"]]} />
        </>
      )}
      {kind === "requests" && (
        <>
          <div className="row">
            <button type="button" className="btn sm" onClick={() => ctx.open({ t: "new-request", kind: "revisit" })}>Send revisit</button>
            <button type="button" className="btn alt sm" onClick={() => ctx.open({ t: "new-request", kind: "inspection" })}>Request inspection</button>
          </div>
          <Seg value={filter} onChange={(v) => { setFilter(v); setLimit(LIST_PAGE); }} label="Request status" items={[["open", "Open"], ["completed", "Completed"], ["rejected", "Rejected"], ["all", "All"]]} />
        </>
      )}
      {kind === "meetings" && (
        <Seg value={filter} onChange={(v) => { setFilter(v); setLimit(LIST_PAGE); }} label="Meetings" items={[["upcoming", "Upcoming"], ["past", "Past"]]} />
      )}
      {kind === "notifications" && rows.some((n) => !(n as NotificationRow).read_at) && (
        <div className="row"><button type="button" className="btn alt sm" onClick={async () => { await markNotificationsRead(); q.reload(); }}>Mark all read</button></div>
      )}
      {(kind === "jobs" || kind === "complaints" || kind === "requests") && (
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
              badge={(j.round ?? 1) > 1 && j.verification_status === "pending" ? <span className="bdg violet">Returned</span> : <Bdg s={VERIFICATION[j.verification_status ?? ""]} />} />
          ))}
          {kind === "complaints" && (rows as ComplaintRow[]).map((c) => (
            <Row key={c.id} onClick={() => ctx.open({ t: "complaint", id: c.id })} title={`${c.code} · ${c.site_name}`}
              sub={`${COMPLAINT_CATEGORY[c.category]} · ${PRIORITY[c.priority]?.label} · ${fmtDate(karachiYmd(c.created_at), { year: false })}`}
              badge={<Bdg s={COMPLAINT_STATUS[c.status]} />} />
          ))}
          {kind === "requests" && (rows as RequestRow[]).map((r) => (
            <Row key={r.id} onClick={() => ctx.open({ t: "request", id: r.id })} title={`${r.code} · ${REQUEST_TYPE[r.type]} · ${r.site_name}`}
              sub={`${r.scheduled_date ? `Scheduled ${fmtDate(r.scheduled_date, { year: false })} ${r.scheduled_time}` : `Recommended ${fmtDate(r.recommended_date, { year: false })}`} · ${r.reason ?? r.purpose}`}
              badge={<Bdg s={REQUEST_STATUS[r.status]} />} />
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

/* ---------- New complaint / request ---------- */
function NewPanel({ panel, ctx }: { panel: Extract<Panel, { t: "new-complaint" | "new-request" }>; ctx: Ctx }) {
  const q = useQuery(async () => panel.job
    ? (must(await ento().from("v_jobs").select("visit_id,job_code,site_id,site_name").eq("visit_id", panel.job).maybeSingle()) as Pick<JobRow, "visit_id" | "job_code" | "site_id" | "site_name"> | null)
    : null, [panel.job]);
  if (!ctx.sites.length) return <p className="empty">No client sites yet.</p>;
  if (panel.job && !q.data && q.loading) return <Loading />;
  const j = q.data;
  const fixed = j ? { siteId: j.site_id, visitId: j.visit_id, label: `${j.job_code} · ${j.site_name}` } : undefined;
  const preset = !j && panel.site ? { siteId: panel.site } : undefined;
  if (panel.t === "new-complaint") {
    return <ComplaintForm userId={ctx.userId} sites={ctx.sites} fixed={fixed} preset={preset}
      onDone={(id) => { ctx.changed(); ctx.replace({ t: "complaint", id }); }} />;
  }
  const done = (id: string) => { ctx.changed(); ctx.replace({ t: "request", id }); };
  if (panel.kind === "revisit") return <RevisitForm sites={ctx.sites} fixed={fixed} preset={preset} onDone={done} />;
  return <RequestForm userId={ctx.userId} sites={ctx.sites} type="inspection"
    preset={preset ?? (j ? { siteId: j.site_id } : undefined)} onDone={done} />;
}
