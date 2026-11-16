"use client";

/**
 * The Entomologist planner — one page, like the Operations visit planner:
 *   left   type filter + Client → Branch tree
 *   centre Month / Week / Day calendar
 *   right  the selected day: your work summary, the selected site, the day's cards
 *   drawer everything else (job verification, reports, complaints, requests,
 *          meetings, site reports, site visits / findings, lists, notifications) slides in from the right.
 * UI only: no data source is connected (see lib/client-data.ts), so it shows empty states.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ento, LIVE_EVENT, OPEN_EVENT } from "@/lib/client-data";
import { MEETING_STATUS, REQUEST_STATUS, RSVP, VERIFICATION, VISIT_STATUS, COMPLAINT_OPEN, REQUEST_OPEN, type Tone } from "@/lib/labels";
import { addDays, addMonths, dayParts, fmtDate, karachiHm, karachiIso, karachiYmd, todayYmd, weekday } from "@/lib/time";
import type { SiteRow } from "@/lib/types";
import { decodePanel, defaultTitle, encodePanel, PanelView, visitSummary, type Ctx, type ListKind, type Panel } from "./panels";

/* ---------- model ---------- */
type Kind = "verification" | "revisit" | "inspection" | "meeting" | "visit";
type Cat = Kind | "action";
type View = "month" | "week" | "day";

type Ev = {
  key: string; kind: Kind; id: string; date: string; time: string;
  title: string; siteId: string | null; company: string; assignee: string;
  status: { label: string; tone: Tone } | null; action: boolean; done: boolean;
};

const TYPES: { key: Cat; label: string; color: string }[] = [
  { key: "verification", label: "Job verification", color: "var(--t-svc)" },
  { key: "revisit", label: "Revisit", color: "var(--t-rev)" },
  { key: "meeting", label: "Meeting", color: "var(--t-meet)" },
  { key: "inspection", label: "Inspection", color: "var(--t-insp)" },
  { key: "visit", label: "My site visits", color: "var(--t-visit)" },
  { key: "action", label: "Needs action", color: "var(--red)" },
];
const TCOL: Record<Kind, string> = { verification: "var(--t-svc)", revisit: "var(--t-rev)", inspection: "var(--t-insp)", meeting: "var(--t-meet)", visit: "var(--t-visit)" };
const KIND_LABEL: Record<Kind, string> = { verification: "Verification", revisit: "Revisit", inspection: "Inspection", meeting: "Meeting", visit: "Site visit" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STORE = "ikpm-ento-planner-v1";
const TICK = (
  <svg className="fo-k" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** "Needs action" is the type filter for anything waiting on you (shown red, like Needs PCO in Operations). */
const typeOk = (e: Ev, types: Cat[]) => !types.length || types.some((t) => (t === "action" ? e.action : e.kind === t));
const panelOf = (e: Ev): Panel =>
  e.kind === "verification" ? { t: "job", id: e.id } : e.kind === "meeting" ? { t: "meeting", id: e.id }
    : e.kind === "visit" ? { t: "visit", id: e.id } : { t: "request", id: e.id };

function rangeOf(view: View, anchor: string) {
  if (view === "day") return { start: anchor, end: anchor };
  if (view === "week") { const start = addDays(anchor, -weekday(anchor)); return { start, end: addDays(start, 6) }; }
  const first = `${anchor.slice(0, 7)}-01`;
  const start = addDays(first, -weekday(first));
  const days = Number(addDays(addMonths(first, 1), -1).slice(8)) + weekday(first);
  return { start, end: addDays(start, Math.ceil(days / 7) * 7 - 1) };
}
function daysBetween(a: string, b: string) { const out: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }

async function fetchEvents(userId: string, start: string, end: string): Promise<Ev[]> {
  const db = ento();
  const today = todayYmd();
  const [jobs, reqs, meets, visits] = await Promise.all([
    db.from("v_jobs").select("visit_id,job_code,kind,visit_status,visit_date,visit_time,site_id,site_name,client_name,pco_name,verification_status")
      // Only jobs the PCO has completed (they get a verification status on completion).
      .not("verification_status", "is", null)
      .gte("visit_date", start).lte("visit_date", end),
    db.from("v_requests").select("id,type,status,site_id,site_name,client_name,recommended_date,scheduled_date,scheduled_time,pco_name")
      .eq("created_by", userId).neq("status", "cancelled")
      .or(`and(scheduled_date.gte.${start},scheduled_date.lte.${end}),and(scheduled_date.is.null,recommended_date.gte.${start},recommended_date.lte.${end})`),
    db.from("v_my_meetings").select("id,title,starts_at,location,status,scheduled_by_name,rsvp")
      .gte("starts_at", karachiIso(start)).lt("starts_at", karachiIso(addDays(end, 1))),
    db.from("v_site_visits").select("id,visit_date,site_id,site_name,client_name,new_findings,fixed_count,not_fixed_count")
      .eq("created_by", userId).gte("visit_date", start).lte("visit_date", end),
  ]);
  const err = jobs.error || reqs.error || meets.error || visits.error;
  if (err) throw new Error(err.message);
  const out: Ev[] = [];
  for (const j of jobs.data ?? []) out.push({
    key: `j${j.visit_id}`, kind: "verification", id: j.visit_id, date: j.visit_date, time: j.visit_time,
    title: j.site_name, siteId: j.site_id, company: j.client_name, assignee: j.pco_name ?? "No PCO",
    // Like Operations: a badge only when it needs attention or is finished.
    status: j.verification_status === "pending" ? { label: "Needs verification", tone: "red" }
      : j.verification_status ? VERIFICATION[j.verification_status]
      : j.visit_status === "started" || j.visit_status === "needs_new_day" ? VISIT_STATUS[j.visit_status] : null,
    // Verified jobs stay fully visible (with their Verified badge), not faded out.
    action: j.verification_status === "pending", done: false,
  });
  for (const r of reqs.data ?? []) out.push({
    key: `r${r.id}`, kind: r.type, id: r.id, date: r.scheduled_date ?? r.recommended_date, time: r.scheduled_time ?? "",
    title: r.site_name, siteId: r.site_id, company: r.client_name,
    assignee: r.pco_name ?? (r.status === "submitted" ? "Awaiting admin" : "PCO not assigned"),
    status: REQUEST_STATUS[r.status] ?? { label: r.status, tone: "gray" }, action: false, done: r.status === "completed",
  });
  for (const m of meets.data ?? []) {
    const date = karachiYmd(m.starts_at);
    const cancelled = m.status === "cancelled";
    out.push({
      key: `m${m.id}`, kind: "meeting", id: m.id, date, time: karachiHm(m.starts_at),
      title: m.title, siteId: null, company: m.location || "Online", assignee: `by ${m.scheduled_by_name}`,
      status: cancelled ? MEETING_STATUS.cancelled : RSVP[m.rsvp] ?? RSVP.pending,
      action: !cancelled && date >= today && m.rsvp === "pending", done: cancelled || date < today,
    });
  }
  for (const v of visits.data ?? []) {
    const issues = v.new_findings + v.not_fixed_count;
    out.push({
      key: `v${v.id}`, kind: "visit", id: v.id, date: v.visit_date, time: "",
      title: v.site_name, siteId: v.site_id, company: v.client_name, assignee: visitSummary(v),
      status: issues ? { label: `${issues} to fix`, tone: "amber" } : { label: "All clear", tone: "green" },
      action: false, done: false,
    });
  }
  return out.sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
}

/* ======================================================================== */
export function Calendar({ userId, sites }: { userId: string; sites: SiteRow[] }) {
  const today = todayYmd();
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(today);
  const [types, setTypes] = useState<Cat[]>([]);              // none ticked = all types (as in Operations)
  const [hidden, setHidden] = useState<string[]>([]);          // unticked site ids
  const [events, setEvents] = useState<Ev[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Panel[]>([]);
  const [title, setTitle] = useState("");
  const [ready, setReady] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panel = stack[stack.length - 1];

  /* view settings remembered in this browser; the open drawer lives in the URL (?open=job_<id>) */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore on the client */
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? "{}");
      if (["month", "week", "day"].includes(s.view)) setView(s.view);
      if (Array.isArray(s.types)) setTypes(s.types);
      if (Array.isArray(s.hidden)) setHidden(s.hidden);
    } catch { /* not remembered */ }
    const p = decodePanel(new URLSearchParams(window.location.search).get("open"));
    if (p) setStack([p]);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORE, JSON.stringify({ view, types, hidden })); } catch { /* ignore */ }
  }, [ready, view, types, hidden]);
  useEffect(() => {
    if (!ready) return;
    const code = encodePanel(panel);
    window.history.replaceState(null, "", code ? `/?open=${code}` : "/");
  }, [ready, panel]);

  /* data */
  const { start, end } = rangeOf(view, anchor);
  const load = useCallback(async () => {
    setLoading(true);
    try { setEvents(await fetchEvents(userId, start, end)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [userId, start, end]);
  const loadCounts = useCallback(async () => {
    const db = ento();
    const h = { count: "exact" as const, head: true };
    const job = (s: string) => db.from("job_assignments").select("id", h).eq("verification_status", s);
    const r = await Promise.all([
      job("pending"), job("verified"), job("rejected"),
      db.from("complaints").select("id", h).eq("created_by", userId).in("status", COMPLAINT_OPEN),
      db.from("activity_requests").select("id", h).eq("created_by", userId).in("status", REQUEST_OPEN),
      db.from("v_my_meetings").select("id", h).gte("starts_at", new Date().toISOString()).neq("status", "cancelled"),
      db.from("site_findings").select("id", h).eq("status", "open"),
    ]);
    const [pending, verified, rejected, complaints, requests, meetings, findings] = r.map((x) => x.count ?? 0);
    setCounts({ pending, verified, rejected, complaints, requests, meetings, findings });
  }, [userId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the visible range
    load();
  }, [load]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the summary numbers
    loadCounts();
  }, [loadCounts]);
  useEffect(() => {
    const onLive = () => { load(); loadCounts(); };
    const onOpen = (e: Event) => { const p = (e as CustomEvent<Panel>).detail; if (p) setStack([p]); };
    window.addEventListener(LIVE_EVENT, onLive);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener(LIVE_EVENT, onLive); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, [load, loadCounts]);

  /* drawer */
  const open = useCallback((p: Panel) => setStack((s) => [...s, p]), []);
  const replace = useCallback((p: Panel) => setStack((s) => [...s.slice(0, -1), p]), []);
  const changed = useCallback(() => { load(); loadCounts(); }, [load, loadCounts]);
  const close = useCallback(() => { setStack([]); opener.current?.focus?.(); }, []);
  const ctx: Ctx = useMemo(() => ({ userId, sites, open, replace, setTitle, changed }), [userId, sites, open, replace, changed]);
  const panelKey = panel ? JSON.stringify(panel) : "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- title follows the panel until it loads its own
    if (panel) setTitle(defaultTitle(panel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelKey]);
  const isOpen = !!panel;
  useEffect(() => { if (isOpen) closeBtn.current?.focus({ preventScroll: true }); }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [isOpen, close]);
  const showPanel = (p: Panel, from?: HTMLElement | null) => { opener.current = from ?? null; setStack([p]); };

  /* filtering (applies to the grid and the day panel) */
  const shown = useMemo(() => events.filter((e) => typeOk(e, types) && !(e.siteId && hidden.includes(e.siteId))), [events, types, hidden]);
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of shown) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [shown]);
  const dayList = byDay.get(anchor) ?? [];
  const clients = useMemo(() => {
    const m = new Map<string, { id: string; name: string; sites: SiteRow[] }>();
    for (const s of sites) {
      const c = m.get(s.client_id) ?? { id: s.client_id, name: s.client_name, sites: [] };
      c.sites.push(s);
      m.set(s.client_id, c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [sites]);
  const visibleSites = sites.filter((s) => !hidden.includes(s.site_id));
  const curSite = sites.length > 1 && visibleSites.length === 1 ? visibleSites[0] : null;

  const toggleType = (k: Cat) => setTypes((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));
  const toggleClient = (ids: string[]) => setHidden((h) => {
    const allOn = ids.every((id) => !h.includes(id));
    return allOn ? [...new Set([...h, ...ids])] : h.filter((id) => !ids.includes(id));
  });
  const toggleSite = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  const nav = (n: -1 | 0 | 1) => {
    if (n === 0) return setAnchor(today);
    if (view === "day") return setAnchor((a) => addDays(a, n));
    if (view === "week") return setAnchor((a) => addDays(a, 7 * n));
    setAnchor((a) => { const m = addMonths(a, n); return m.slice(0, 7) === today.slice(0, 7) ? today : m; });
  };

  /* ---------- pieces ---------- */
  const pill = (e: Ev, big = false) => (
    <button key={e.key} type="button"
      className={`pl ${e.kind}${e.done ? " dn" : ""}${e.action ? " req" : ""}`}
      style={big ? { fontSize: "var(--fs-m)", lineHeight: "22px", padding: "1px var(--s2)", width: "auto" } : undefined}
      title={`${e.time ? `${e.time} ` : ""}${e.title} · ${KIND_LABEL[e.kind]}${e.status ? ` · ${e.status.label}` : ""}`}
      onClick={(ev) => { ev.stopPropagation(); setAnchor(e.date); showPanel(panelOf(e), ev.currentTarget); }}>
      {e.time && <b>{e.time}</b>}<span className="pl-t">{e.title}</span>
    </button>
  );
  const cell = (ds: string, max: number, outside: boolean) => {
    const list = byDay.get(ds) ?? [];
    const p = dayParts(ds);
    const pick = () => setAnchor(ds);
    return (
      <div key={ds} className={`gc-day${outside ? " out" : ""}${ds === anchor ? " sel" : ""}`} role="button" tabIndex={0}
        aria-label={`${p.long} ${p.day} ${p.month}, ${list.length} ${list.length === 1 ? "item" : "items"}`}
        onClick={pick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }}>
        <span className={`gc-n${ds === today ? " today" : ""}`}>{p.day}</span>
        {list.slice(0, max).map((e) => pill(e))}
        {list.length > max && <span className="gc-more">{list.length - max} more</span>}
      </div>
    );
  };
  const card = (e: Ev) => {
    const p = dayParts(e.date);
    const cur = panel && "id" in panel && panel.id === e.id;
    return (
      <article key={e.key} className={`visit tap${e.action ? " attn" : ""}${e.done ? " done" : ""}${cur ? " cur" : ""}`}
        role="button" tabIndex={0} aria-label={`${e.time} ${e.title}, ${KIND_LABEL[e.kind]}${e.status ? `, ${e.status.label}` : ""}`}
        onClick={(ev) => showPanel(panelOf(e), ev.currentTarget)}
        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); showPanel(panelOf(e), ev.currentTarget); } }}>
        <div className="when"><b>{p.day}</b><span>{p.month}</span><small>{p.weekday}</small>{e.time && <em>{e.time}</em>}</div>
        <div className="what">
          <div className="v-top"><span className="v-t" title={e.title}>{e.title}</span>{e.status && <span className={`bdg ${e.status.tone}`}>{e.status.label}</span>}</div>
          <div className="v-co" title={e.company}>{e.company}</div>
          <div className="v-s" style={{ "--c": e.action ? "var(--red)" : TCOL[e.kind] } as CSSProperties}><i />{KIND_LABEL[e.kind]} · {e.assignee}</div>
        </div>
      </article>
    );
  };

  /* ---------- grid ---------- */
  let grid: React.ReactNode;
  let label: string;
  if (view === "month") {
    label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${anchor.slice(0, 7)}-15T12:00:00Z`));
    grid = (
      <div className="gc-grid">
        {WEEKDAYS.map((n) => <div key={n} className="gc-h">{n}</div>)}
        {daysBetween(start, end).map((d) => cell(d, 3, d.slice(0, 7) !== anchor.slice(0, 7)))}
      </div>
    );
  } else if (view === "week") {
    label = `${fmtDate(start, { year: false, weekday: false })} – ${fmtDate(end, { weekday: false })}`;
    grid = (
      <div className="gc-grid gc-week">
        {WEEKDAYS.map((n) => <div key={n} className="gc-h">{n}</div>)}
        {daysBetween(start, end).map((d) => cell(d, 30, false))}
      </div>
    );
  } else {
    label = fmtDate(anchor);
    const hours = new Set(["08", "09", "10", "11", "12", "13", "14", "15", "16", "17"]);
    dayList.forEach((e) => e.time && hours.add(e.time.slice(0, 2)));
    const untimed = dayList.filter((e) => !e.time);
    const row = (e: Ev) => <div key={e.key} className="dv-e">{pill(e, true)}<span className="dv-s">{KIND_LABEL[e.kind]} · {e.assignee}</span></div>;
    grid = (
      <div className="gc-dv">
        {untimed.length > 0 && <div className="dv-row"><span className="dv-t">—</span><div className="dv-c">{untimed.map(row)}</div></div>}
        {[...hours].sort().map((h) => (
          <div key={h} className="dv-row"><span className="dv-t">{h}:00</span><div className="dv-c">{dayList.filter((e) => e.time.slice(0, 2) === h).map(row)}</div></div>
        ))}
      </div>
    );
  }

  const work: [ListKind, string, string][] = [
    ["findings", "findings", "Findings"], ["complaints", "complaints", "Complaints"],
  ];

  return (
    <>
      <div className="layout">
        <aside className="side" aria-label="Filters">
          <div className="fb">
            <section className="fs">
              <div className="fs-h"><h3>Your work</h3></div>
              <div className="fs-l" role="group" aria-label="Your work">
                {work.map(([k, key, l]) => (
                  <button key={k} type="button" className="fo wk" onClick={(e) => showPanel({ t: "list", id: k }, e.currentTarget)}>
                    <i className="fo-d" style={{ background: key === "complaints" ? "var(--red)" : "var(--t-insp)" }} />
                    <span className="fo-n">{l}</span>
                    {key !== "findings" && (counts[key] ?? 0) > 0 && <span className={`fo-c${key === "complaints" ? " hot" : ""}`}>{counts[key]}</span>}
                  </button>
                ))}
              </div>
            </section>
            <section className="fs">
              <div className="fs-h">
                <h3>Type</h3>
                <button type="button" className="fs-clear" disabled={!types.length} onClick={() => setTypes([])}>Clear</button>
              </div>
              <div className="fs-l" role="group" aria-label="Show these types">
                {TYPES.map((t) => {
                  const on = types.includes(t.key);
                  const n = events.filter((e) => (t.key === "action" ? e.action : e.kind === t.key) && !(e.siteId && hidden.includes(e.siteId))).length;
                  return (
                    <label key={t.key} className={`fo ty${on ? " on" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleType(t.key)} />
                      <i className="fo-d" style={{ background: t.color }} />
                      <span className="fo-n">{t.label}</span>
                      {on ? TICK : n > 0 && <span className={`fo-c${t.key === "action" ? " hot" : ""}`}>{n}</span>}
                    </label>
                  );
                })}
              </div>
            </section>
            <section className="fs">
              <div className="fs-h">
                <h3>Company</h3>
                <button type="button" className="fs-clear" disabled={!hidden.length} onClick={() => setHidden([])}>Clear</button>
              </div>
              <div className="fs-l" role="group" aria-label="Show these companies">
                {!clients.length && <p className="note" style={{ padding: "0 8px" }}>No client sites yet.</p>}
                {clients.map((c) => {
                  const ids = c.sites.map((s) => s.site_id);
                  const n = ids.filter((id) => !hidden.includes(id)).length;
                  const on = n === ids.length, part = n > 0 && !on;
                  const attn = events.filter((e) => e.action && e.siteId && ids.includes(e.siteId)).length;
                  return (
                    <div key={c.id} style={{ display: "contents" }}>
                      <label className={`fo co${on ? " on" : ""}${part ? " part" : ""}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleClient(ids)} />
                        <span className="fo-r" /><span className="fo-n" title={c.name}>{c.name}</span>
                        {attn > 0 && <span className="fo-c hot" title={`${attn} need action`}>{attn}</span>}
                      </label>
                      {c.sites.length > 1 && c.sites.map((s) => {
                        const son = !hidden.includes(s.site_id);
                        return (
                          <label key={s.site_id} className={`fo co sub${son ? " on" : ""}`}>
                            <input type="checkbox" checked={son} onChange={() => toggleSite(s.site_id)} />
                            <span className="fo-r" /><span className="fo-n" title={s.site_name}>{s.site_name}</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </aside>

        <section className="center" aria-label={`Calendar, ${label}`}>
          <section className="gc">
            <div className="gc-top">
              <div className="seg" role="group" aria-label="Calendar view">
                {(["month", "week", "day"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
                ))}
              </div>
              <span className="gc-load" aria-live="polite">{loading ? "Loading…" : null}</span>
              <div className="gc-nav" style={{ marginInlineStart: "auto" }}>
                <button type="button" aria-label={`Previous ${view}`} onClick={() => nav(-1)}>&lsaquo;</button>
                <button type="button" className="gc-today" onClick={() => nav(0)}>Today</button>
                <button type="button" aria-label={`Next ${view}`} onClick={() => nav(1)}>&rsaquo;</button>
              </div>
            </div>
            {error && <p className="err" role="alert" style={{ margin: "0 16px 12px" }}>Could not load: {error}</p>}
            {grid}
          </section>
        </section>

        <main className="main" aria-label="Selected day">
          <div className="head">
            <h1>{anchor === today ? "Today" : dayParts(anchor).long}</h1>
            <p>{new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${anchor}T12:00:00Z`))}</p>
            {dayList.length > 0 && <span className="head-c">{dayList.length}</span>}
          </div>
          {curSite && (
            <section className="sitecard">
              <div className="sc-t"><b>{curSite.site_name}</b><span>{curSite.client_name}{curSite.city ? ` · ${curSite.city}` : ""}</span></div>
              <div className="acts">
                <button type="button" className="btn sm" onClick={(e) => showPanel({ t: "gap", id: curSite.site_id, edit: true }, e.currentTarget)}>Record visit</button>
                <button type="button" className="btn alt sm" onClick={(e) => showPanel({ t: "site", id: curSite.site_id }, e.currentTarget)}>Site report</button>
                <button type="button" className="btn alt sm" onClick={(e) => showPanel({ t: "new-complaint", site: curSite.site_id }, e.currentTarget)}>Lodge complaint</button>
                <button type="button" className="btn alt sm" onClick={(e) => showPanel({ t: "new-request", kind: "inspection", site: curSite.site_id }, e.currentTarget)}>Request inspection</button>
              </div>
            </section>
          )}
          {dayList.length ? dayList.map(card) : <p className="empty">{loading ? "Loading…" : "Nothing scheduled"}</p>}
        </main>
      </div>

      {/* Slide-in drawer (not a page change): the calendar and its filters stay as they were. */}
      <div className={`drawer${isOpen ? " open" : ""}`} inert={!isOpen}>
        <div className="dr-scrim" onClick={close} />
        <aside className={`dr-panel${panel?.t === "gap" ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dr-title">
          <header className="dr-h">
            {stack.length > 1 && (
              <button type="button" className="dr-x" aria-label="Back" onClick={() => setStack((s) => s.slice(0, -1))}>&lsaquo;</button>
            )}
            <h2 id="dr-title">{title}</h2>
            <button type="button" className="dr-x" aria-label="Close" onClick={close} ref={closeBtn}>×</button>
          </header>
          <div className="dr-b">
            {panel && <PanelView key={panelKey} panel={panel} ctx={ctx} />}
          </div>
        </aside>
      </div>
    </>
  );
}
