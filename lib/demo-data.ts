/**
 * Sample data for checking the UI and the forms without a backend.
 *
 * An in-memory copy of the ento.* / ops.* rows the screens read. Dates are relative to
 * today, so the calendar always has something to show. The form actions in app/actions.ts
 * write into this store, so Verify, Complaint, inspection reports, etc. visibly change the
 * screens (until the page is reloaded). Delete this file and the store calls when a real
 * data source is connected.
 *
 * Workflow it models:
 *   job      PCO completes a service → entomologist Verifies it, or marks it a Complaint:
 *              service issue  → Operations marks the site as a complaint and schedules a
 *                               complaint service (a new job, verified the same way);
 *              document issue → Operations corrects the documents / pictures and the job
 *                               comes back for verification (next round).
 *   inspection  Admin assigns an inspection → entomologist submits the report (a site visit
 *               with findings, and re-checks of earlier findings).
 */
import { addDays, karachiIso, todayYmd } from "@/lib/time";
import type {
  AttachmentRow, ComplaintRow, ComplaintUpdateRow, FindingCheckRow, FindingRow, InspectionTaskRow, JobRow, MeetingRow,
  NotificationRow, SiteRow, SiteVisitRow, VerificationRow,
} from "@/lib/types";

/** Same placeholder user as lib/auth.ts — rows "by you" use this id. */
export const DEMO_USER = "00000000-0000-4000-8000-000000000000";
export const ME_NAME = "Entomologist";

/** Readable fixed UUIDs: <2-hex table prefix>000000-0000-4000-8000-<n>. */
const uid = (t: string, n: number) => `${t}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const newDemoId = (t = "ee") => uid(t, Math.floor(Math.random() * 1e11) + 1000);

const T = todayYmd();
const day = (n: number) => addDays(T, n);
/** An instant n days from today at a Karachi wall-clock time, as UTC ISO (sorts and compares cleanly). */
const at = (n: number, hm = "10:00") => new Date(karachiIso(day(n), hm)).toISOString();
export const nowIso = () => new Date().toISOString();

/* ---------- clients and branches ---------- */
export const DEMO_SITES: SiteRow[] = [
  { site_id: uid("a1", 1), site_name: "Gulberg Kitchen", city: "Lahore", address: "12-B Main Boulevard, Gulberg III", site_status: "active", client_id: uid("c1", 1), client_name: "Serena Foods (sample)", client_code: "SF", is_primary: true },
  { site_id: uid("a1", 2), site_name: "DHA Phase 5 Outlet", city: "Lahore", address: "Commercial Area, DHA Phase 5", site_status: "active", client_id: uid("c1", 1), client_name: "Serena Foods (sample)", client_code: "SF", is_primary: false },
  { site_id: uid("a1", 3), site_name: "Main Campus", city: "Karachi", address: "Shahrah-e-Faisal", site_status: "active", client_id: uid("c1", 2), client_name: "City Hospital (sample)", client_code: "CH", is_primary: true },
  { site_id: uid("a1", 4), site_name: "Blue Area Hotel", city: "Islamabad", address: "Jinnah Avenue, Blue Area", site_status: "active", client_id: uid("c1", 3), client_name: "Pearl Hotels (sample)", client_code: "PH", is_primary: true },
  { site_id: uid("a1", 5), site_name: "Clifton Hotel", city: "Karachi", address: "Block 4, Clifton", site_status: "active", client_id: uid("c1", 3), client_name: "Pearl Hotels (sample)", client_code: "PH", is_primary: false },
];
const S = (n: number) => DEMO_SITES[n - 1];

const PCOS = [
  { id: uid("p1", 1), name: "Imran Ali", phone: "0300-1234567" },
  { id: uid("p1", 2), name: "Bilal Ahmed", phone: "0321-7654321" },
  { id: uid("p1", 3), name: "Usman Tariq", phone: "0333-1112223" },
  { id: uid("p1", 4), name: "Kashif Raza", phone: "0345-9998887" },
];

/* ---------- jobs (ops visits + their verification assignment) ---------- */
type JobSeed = {
  n: number; site: number; d: number; time: string; kind: "monthly" | "contract" | "complaint_service"; pco: number;
  status: "pending" | "verified" | "complaint" | null; round?: number; returnNote?: string; complaint?: number;
  treatments: string[]; findings?: string[]; notes?: string; outcome?: "completed" | "partial";
};
const JOB_SEEDS: JobSeed[] = [
  { n: 1, site: 1, d: -1, time: "09:00", kind: "monthly", pco: 1, status: "pending", treatments: ["Gel baiting", "Spray"], findings: ["Cockroach activity under the dish-wash station", "Drain cover missing near cold store"], notes: "Kitchen staff informed about drain covers." },
  { n: 2, site: 3, d: -1, time: "14:30", kind: "contract", pco: 2, status: "pending", treatments: ["Rodent bait stations", "Fogging"], findings: ["Rodent droppings in basement store"], outcome: "partial", notes: "Basement store was locked; covered remaining areas." },
  // Document issue earlier → Operations corrected the documents → back for verification (round 2).
  { n: 3, site: 4, d: -2, time: "11:00", kind: "monthly", pco: 3, status: "pending", round: 2, returnNote: "Documents corrected by Operations: challan photo re-uploaded and store-area photos added.", treatments: ["Spray", "Glue boards"] },
  // Complaint service Operations scheduled for the service issue on job 14 — now completed, waiting for you.
  { n: 4, site: 2, d: -3, time: "10:00", kind: "complaint_service", pco: 1, status: "pending", complaint: 1, treatments: ["Gel baiting", "Spray"], findings: ["Low cockroach activity behind the fryer"] },
  { n: 5, site: 5, d: 0, time: "08:30", kind: "monthly", pco: 4, status: "pending", treatments: ["Spray", "Fly catchers"] },
  { n: 6, site: 1, d: -8, time: "09:00", kind: "monthly", pco: 1, status: "verified", treatments: ["Gel baiting", "Spray"], findings: ["No activity seen"] },
  { n: 7, site: 3, d: -9, time: "15:00", kind: "contract", pco: 2, status: "verified", treatments: ["Rodent bait stations"] },
  { n: 8, site: 4, d: -12, time: "11:30", kind: "monthly", pco: 3, status: "verified", treatments: ["Spray"] },
  { n: 9, site: 5, d: -14, time: "10:00", kind: "monthly", pco: 4, status: "verified", treatments: ["Fogging", "Spray"] },
  { n: 10, site: 2, d: -16, time: "13:00", kind: "monthly", pco: 1, status: "verified", treatments: ["Gel baiting"] },
  { n: 11, site: 1, d: -20, time: "09:30", kind: "contract", pco: 2, status: "verified", round: 2, treatments: ["Termite drilling"] },
  { n: 12, site: 3, d: -5, time: "16:00", kind: "monthly", pco: 3, status: "complaint", treatments: ["Spray"], findings: ["Ward 3 pantry not treated"] },
  { n: 13, site: 4, d: -6, time: "12:00", kind: "monthly", pco: 4, status: "complaint", treatments: ["Glue boards"] },
  { n: 14, site: 2, d: -10, time: "10:30", kind: "monthly", pco: 1, status: "complaint", treatments: ["Gel baiting", "Spray"], findings: ["Heavy cockroach activity in store room"] },
  // Not completed yet (no verification status) — these must NOT show to the entomologist.
  { n: 15, site: 1, d: 2, time: "09:00", kind: "monthly", pco: 1, status: null, treatments: ["Spray"] },
  { n: 16, site: 3, d: 0, time: "17:00", kind: "contract", pco: 2, status: null, treatments: ["Fogging"] },
  { n: 17, site: 5, d: 4, time: "11:00", kind: "monthly", pco: 4, status: null, treatments: ["Spray"] },
  { n: 18, site: 3, d: 2, time: "10:00", kind: "complaint_service", pco: 3, status: null, complaint: 2, treatments: ["Spray"] },
];

function addHm(hm: string, h: number) {
  const [a, b] = hm.split(":").map(Number);
  return `${String(Math.min(a + h, 23)).padStart(2, "0")}:${String(b).padStart(2, "0")}`;
}

function makeJob(s: JobSeed): JobRow {
  const site = S(s.site);
  const pco = PCOS[s.pco - 1];
  const v = uid("b1", s.n);
  const done = s.status !== null;
  const submitted = done ? at(s.d, addHm(s.time, 2)) : null;
  return {
    visit_id: v, job_code: `JOB-${String(2400 + s.n)}`, kind: s.kind,
    visit_status: done ? "done" : s.d === 0 ? "started" : "scheduled",
    visit_date: day(s.d), visit_time: s.time, treatments: s.treatments,
    visit_note: s.kind === "complaint_service" ? "Complaint service: repeat treatment after the entomologist's complaint." : null,
    complaint_id: s.complaint ? uid("e1", s.complaint) : null, started_at: done || s.d === 0 ? at(s.d, s.time) : null,
    before_photos: done ? [`${v}/before/1.jpg`, `${v}/before/2.jpg`] : [],
    site_id: site.site_id, site_name: site.site_name, site_city: site.city, site_address: site.address,
    client_id: site.client_id, client_name: site.client_name,
    pco_id: pco.id, pco_name: pco.name, pco_phone: pco.phone, crew_names: s.n % 3 === 0 ? ["Asad (helper)"] : null,
    outcome: done ? s.outcome ?? "completed" : null,
    items: done ? [{ name: "Cypermethrin 10% EC", qty: 250, unit: "ml" }, { name: "Cockroach gel", qty: 2, unit: "tubes" }] : null,
    extras: done && s.n === 2 ? [{ work: "Extra fogging in basement", charge: 3500 }] : null,
    findings: done ? s.findings ?? null : null,
    report_notes: done ? s.notes ?? null : null,
    found_photos: done && s.findings?.length ? s.findings.map((_, i) => `${v}/findings/${i + 1}/1.jpg`) : null,
    after_photos: done ? [`${v}/during/1.jpg`, `${v}/during/2.jpg`, `${v}/during/3.jpg`] : null,
    challan_no: done ? `CH-${8800 + s.n}` : null, challan_date: done ? day(s.d) : null,
    challan_file: done ? (s.n === 3 ? `${v}/challan.pdf` : `${v}/challan.jpg`) : null,
    submitted_by_name: done ? pco.name : null, submitted_at: submitted,
    team_names: done ? [pco.name, ...(s.n % 3 === 0 ? ["Asad (helper)"] : [])] : null,
    assignment_id: done ? uid("b2", s.n) : null, assigned_to: done ? DEMO_USER : null,
    verification_status: s.status, completed_at: submitted, round: done ? s.round ?? 1 : null,
    return_note: s.returnNote ?? null,
    last_decision: null, last_note: null, last_issue: null, last_verifier_name: null, last_decided_at: null,
  };
}

/* ---------- the store ---------- */
type VisitBase = Omit<SiteVisitRow, "new_findings" | "fixed_count" | "not_fixed_count">;
type Store = {
  jobs: JobRow[]; verifs: VerificationRow[]; complaints: ComplaintRow[]; updates: ComplaintUpdateRow[];
  meetings: MeetingRow[]; notifications: (NotificationRow & { assigned_to: string })[]; attachments: AttachmentRow[];
  tasks: InspectionTaskRow[]; visits: VisitBase[]; findings: FindingRow[]; checks: FindingCheckRow[];
  siteIssues: { id: string; site_id: string; description: string; open: boolean; created_at: string }[];
};

function seed(): Store {
  const jobs = JOB_SEEDS.map(makeJob);
  const J = (n: number) => jobs[n - 1];
  const stamp = (j: JobRow, hours: number) => new Date(Date.parse(j.submitted_at!) + hours * 3600_000).toISOString();

  const verifs: VerificationRow[] = [
    vf(1, J(3), 1, "complaint", stamp(J(3), 2), "Challan photo is blurry and the signature is not readable; store-area photos missing.", "document", 4),
    vf(2, J(6), 1, "verified", stamp(J(6), 20), "Good coverage; photos clear."),
    vf(3, J(7), 1, "verified", stamp(J(7), 3), null),
    vf(4, J(8), 1, "verified", stamp(J(8), 26), "Glue boards placed as advised.", null, null, "other"),
    vf(5, J(9), 1, "verified", stamp(J(9), 4), null),
    vf(6, J(10), 1, "verified", stamp(J(10), 40), "OK."),
    vf(7, J(11), 1, "complaint", stamp(J(11), 2), "Drilling depth not recorded in the report.", "document", 5),
    vf(8, J(11), 2, "verified", stamp(J(11), 50), "Depth added by Operations. Verified."),
    vf(9, J(12), 1, "complaint", stamp(J(12), 3), "Ward 3 pantry was listed as a finding but not treated. Cockroaches seen by nursing staff.", "service", 2),
    vf(10, J(13), 1, "complaint", stamp(J(13), 20), "Only one before-service photo; the store area pictures are missing.", "document", 3),
    vf(11, J(14), 1, "complaint", stamp(J(14), 2), "Heavy cockroach activity remains in the store room after the service.", "service", 1),
  ];
  for (const j of jobs) applyLast(j, verifs);

  const complaints: ComplaintRow[] = [
    cmp(1, J(14), "service", "Heavy cockroach activity remains in the store room after the service.", "resolved", J(4)),
    cmp(2, J(12), "service", "Ward 3 pantry was listed as a finding but not treated. Cockroaches seen by nursing staff.", "in_progress", J(18)),
    cmp(3, J(13), "document", "Only one before-service photo; the store area pictures are missing.", "submitted"),
    cmp(4, J(3), "document", "Challan photo is blurry and the signature is not readable; store-area photos missing.", "resolved"),
    cmp(5, J(11), "document", "Drilling depth not recorded in the report.", "resolved"),
  ];
  const updates: ComplaintUpdateRow[] = [
    upd(1, 1, "status", "submitted", "in_progress", "Site marked as complaint. Complaint service scheduled with Imran Ali.", "Operations Manager", -9),
    upd(2, 1, "status", "in_progress", "resolved", "Complaint service completed by Imran Ali. Sent to the entomologist for verification.", "Operations Manager", -3),
    upd(3, 2, "status", "submitted", "in_progress", `Site marked as complaint. Complaint service scheduled for ${day(2)} at 10:00 with Usman Tariq.`, "Operations Manager", -4),
    upd(4, 2, "comment", null, null, "Please make sure the pantry is treated this time.", ME_NAME, -3, true),
    upd(5, 4, "status", "submitted", "resolved", "Challan re-uploaded and store-area photos added. Returned to the entomologist for verification.", "Operations Manager", -1),
    upd(6, 5, "status", "submitted", "resolved", "Drilling depth added to the report.", "Operations Manager", -18),
  ];

  const tasks: InspectionTaskRow[] = [
    task(1, 1, -15, "10:00", "Inspection after the new kitchen layout", "Check every station of the new kitchen and record all gaps.", "submitted", 1),
    task(2, 1, -4, "11:00", "Follow-up of open findings", "Re-check the drain cover and the sink gap.", "submitted", 2),
    task(3, 3, -7, "09:30", "Rodent risk assessment — basement", null, "submitted", 3),
    task(4, 4, -11, "12:00", "Pre-audit inspection before the food-safety audit", null, "submitted", 4),
    task(5, 2, -2, "15:00", "Kitchen deep-clean follow up", "Client asked for a written report with photos.", "assigned"),
    task(6, 5, 0, "16:00", "Bed bug complaint in rooms 204–206", "Inspect mattresses, headboards and luggage racks.", "assigned"),
    task(7, 3, 3, "10:00", "Quarterly rodent risk assessment", null, "assigned"),
  ];

  const visits: VisitBase[] = [
    svisit(1, 1, -15, "medium", "First inspection after the new kitchen layout.", 1),
    svisit(2, 1, -4, "low", "Re-check of earlier findings; drain still open.", 2),
    svisit(3, 3, -7, "high", "Rodent signs in basement; client informed.", 3),
    svisit(4, 4, -11, "none", null, 4),
  ];
  const findings: FindingRow[] = [
    fnd(1, 1, 1, "structural", "Kitchen", "Dish-wash area", "Gap between wall and sink unit allows cockroach harbourage", "high", "client", "Seal the gap with silicone", "Cockroach breeding"),
    fnd(2, 1, 1, "hygiene", "Kitchen", "Cold store", "Drain cover missing near cold store", "critical", "client", "Install a fine-mesh drain cover", "Rodent and cockroach entry"),
    fnd(3, 1, 1, "housekeeping", "Store", "Dry store", "Cartons stored directly on the floor", "medium", "shared", "Use pallets 15 cm off the floor", "Harbourage"),
    fnd(4, 1, 2, "waste", "Back yard", "Waste area", "Waste bins left open overnight", "medium", "client", "Lidded bins, emptied daily", "Fly breeding"),
    fnd(5, 3, 3, "pest_activity", "Basement", "Main store", "Rodent droppings and gnaw marks on cartons", "critical", "ikpm", "Add bait stations; weekly monitoring", "Contamination"),
    fnd(6, 3, 3, "structural", "Basement", "Cable duct", "Open cable duct to the outside", "high", "client", "Close with steel wool and sealant", "Rodent entry"),
    fnd(7, 4, 4, "other", "Lobby", "Planters", "Standing water in planters", "low", "client", "Drain planters weekly", "Mosquito breeding"),
  ];
  const checks: FindingCheckRow[] = [
    chk(1, 3, 2, "fixed", "Pallets in place."),
    chk(2, 2, 2, "not_fixed", "Cover still missing."),
    chk(3, 1, 2, "not_fixed", "Gap partly sealed only."),
  ];
  Object.assign(findings[2], { status: "fixed", fixed_visit_id: uid("71", 2), fixed_on: day(-4), fixed_by_name: ME_NAME });

  const meetings: MeetingRow[] = [
    meet(1, "Monthly verification review", 1, "11:00", "12:00", "Head office, Lahore", null, "1. Pending verifications\n2. Complaint trends\n3. Photo quality", "scheduled", "pending", "unmarked"),
    meet(2, "Hospital contract walkthrough", 3, "15:00", "16:30", "City Hospital, Main Campus", null, "Walk through basement stores with the facility manager.", "scheduled", "confirmed", "unmarked"),
    meet(3, "Weekly entomology call", 0, "17:00", "17:30", null, "https://meet.example.com/ento-weekly", "Open findings across branches.", "rescheduled", "confirmed", "unmarked"),
    meet(4, "Training: termite treatment standards", -4, "10:00", "12:00", "Training room", null, "Drilling depth, chemical dilution, reporting.", "completed", "confirmed", "attended", "Depth must be recorded for every drill point."),
    meet(5, "Client review — Pearl Hotels", 6, "12:00", "13:00", "Blue Area Hotel", null, null, "cancelled", "pending", "unmarked", null, "Client asked to move it to next month."),
  ];

  const notifications: Store["notifications"] = [
    ntf(1, "job", "New job to verify", `${J(1).site_name} · ${J(1).job_code} was completed by ${J(1).pco_name}.`, `/jobs/${J(1).visit_id}`, -0.1),
    ntf(2, "job", "Documents corrected — verify again", `${J(3).job_code}: ${J(3).return_note}`, `/jobs/${J(3).visit_id}`, -0.5),
    ntf(3, "inspection", "Inspection assigned", `${S(5).site_name}: Bed bug complaint in rooms 204–206 — today 16:00.`, `/inspections/${uid("d1", 6)}`, -1),
    ntf(4, "job", "Complaint service completed", `${J(4).job_code} at ${J(4).site_name} is ready for verification.`, `/jobs/${J(4).visit_id}`, -3, true),
    ntf(5, "complaint", "Complaint service scheduled", `CMP-0002: complaint service on ${day(2)} at 10:00.`, `/complaints/${uid("e1", 2)}`, -4),
    ntf(6, "meeting", "Meeting invitation", "Monthly verification review — please confirm.", `/meetings/${uid("f1", 1)}`, -1, true),
  ];

  const attachments: AttachmentRow[] = [
    att(1, "site_visit", uid("71", 1), "kitchen-overview.jpg"), att(2, "site_visit", uid("71", 3), "basement.jpg"),
    att(3, "site_finding", uid("72", 1), "sink-gap.jpg"), att(4, "site_finding", uid("72", 2), "drain.jpg"),
    att(5, "site_finding", uid("72", 5), "droppings.jpg"), att(6, "site_finding", uid("72", 5), "gnaw-marks.jpg"),
  ];

  return {
    jobs, verifs, complaints, updates, meetings, notifications, attachments, tasks, visits, findings, checks,
    siteIssues: [
      { id: uid("75", 1), site_id: S(1).site_id, description: "Drain cover missing near cold store (reported by PCO)", open: true, created_at: at(-1) },
      { id: uid("75", 2), site_id: S(3).site_id, description: "Basement store locked during service", open: true, created_at: at(-1) },
    ],
  };

  /* builders */
  function vf(n: number, job: JobRow, round: number, decision: "verified" | "complaint", created: string, note: string | null,
    issue: "service" | "document" | null = null, complaint: number | null = null, by: "me" | "other" = "me"): VerificationRow {
    return {
      id: uid("b3", n), assignment_id: job.assignment_id!, visit_id: job.visit_id, round, decision, issue, note,
      complaint_id: complaint ? uid("e1", complaint) : null,
      created_by: by === "me" ? DEMO_USER : uid("u1", 9), verifier_name: by === "me" ? ME_NAME : "Dr. Hina Shah", created_at: created,
    };
  }
  function cmp(n: number, job: JobRow, issue: "service" | "document", description: string, status: string, service?: JobRow): ComplaintRow {
    const v = verifs.find((x) => x.complaint_id === uid("e1", n))!;
    return {
      id: uid("e1", n), code: `CMP-${String(n).padStart(4, "0")}`, client_id: job.client_id, site_id: job.site_id, visit_id: job.visit_id,
      issue, description, status, created_by: DEMO_USER, created_by_name: ME_NAME,
      resolved_at: status === "resolved" ? nowIso() : null, created_at: v.created_at, updated_at: v.created_at,
      site_name: job.site_name, client_name: job.client_name, job_code: job.job_code, job_date: job.visit_date,
      service_visit_id: service?.visit_id ?? null, service_job_code: service?.job_code ?? null, service_date: service?.visit_date ?? null,
    };
  }
  function upd(n: number, c: number, kind: ComplaintUpdateRow["kind"], from: string | null, to: string | null, message: string | null, author: string, d: number, mine = false): ComplaintUpdateRow {
    return { id: uid("e2", n), complaint_id: uid("e1", c), kind, from_status: from, to_status: to, message, created_by: mine ? DEMO_USER : uid("u1", 2), author_name: author, author_role: mine ? "entomologist" : "operations", created_at: at(d, "15:00") };
  }
  function task(n: number, site: number, d: number, time: string, purpose: string, instructions: string | null, status: "assigned" | "submitted", visit?: number): InspectionTaskRow {
    const s = S(site);
    return {
      id: uid("d1", n), code: `INS-${String(n).padStart(4, "0")}`, site_id: s.site_id, site_name: s.site_name, site_city: s.city,
      client_id: s.client_id, client_name: s.client_name, inspection_date: day(d), inspection_time: time, purpose, instructions,
      assigned_to: DEMO_USER, assigned_by_name: "Admin Office", assigned_at: at(d - 5, "12:00"), status,
      site_visit_id: visit ? uid("71", visit) : null, submitted_at: visit ? at(d, "16:00") : null,
    };
  }
  function svisit(n: number, site: number, d: number, pest: string, notes: string | null, inspection: number): VisitBase {
    const s = S(site);
    return { id: uid("71", n), code: `SV-${String(n).padStart(4, "0")}`, inspection_id: uid("d1", inspection), site_id: s.site_id, site_name: s.site_name, site_city: s.city, client_id: s.client_id, client_name: s.client_name, visit_date: day(d), pest_activity: pest, notes, created_by: DEMO_USER, created_by_name: ME_NAME, created_at: at(d, "16:00") };
  }
  function fnd(n: number, site: number, visit: number, category: string, department: string, area: string, description: string, severity: string, responsibility: string, recommendation: string, risk: string): FindingRow {
    const s = S(site);
    const v = visits[visit - 1];
    return {
      id: uid("72", n), code: `F-${String(n).padStart(3, "0")}`, site_id: s.site_id, site_name: s.site_name, site_city: s.city, client_id: s.client_id, client_name: s.client_name,
      area, description, severity, category, department, risk, recommendation, responsibility, status: "open",
      found_visit_id: v.id, found_visit_code: v.code, found_on: v.visit_date, fixed_visit_id: null, fixed_on: null, fixed_by_name: null,
      created_by: DEMO_USER, created_by_name: ME_NAME, created_at: v.created_at, last_result: null, last_checked_on: null, last_checked_by: null, times_not_fixed: 0,
    };
  }
  function chk(n: number, finding: number, visit: number, result: "fixed" | "not_fixed", note: string): FindingCheckRow {
    return { id: uid("73", n), finding_id: uid("72", finding), site_visit_id: uid("71", visit), result, note, created_by: DEMO_USER, created_by_name: ME_NAME, created_at: visits[visit - 1].created_at };
  }
  function meet(n: number, title: string, d: number, from: string, to: string, location: string | null, link: string | null, agenda: string | null, status: string, rsvp: string, attendance: string, notes: string | null = null, cancel: string | null = null): MeetingRow {
    return {
      id: uid("f1", n), title, starts_at: at(d, from), ends_at: at(d, to), location, online_link: link, agenda, status, cancel_reason: cancel,
      scheduled_by_name: "Admin Office", created_at: at(-10), updated_at: at(-2), attendance_id: uid("f2", n), rsvp,
      rsvp_at: rsvp === "pending" ? null : at(-2), attendance, attendance_at: attendance === "unmarked" ? null : at(d, to), my_notes: notes,
    };
  }
  function ntf(n: number, kind: string, title: string, body: string, link: string, d: number, read = false) {
    const created = Date.now() + d * 86400_000;
    return { id: uid("91", n), kind, title, body, link, entity_type: kind, entity_id: link.split("/").pop()!, read_at: read ? new Date(created + 3600_000).toISOString() : null, created_at: new Date(created).toISOString(), assigned_to: DEMO_USER };
  }
  function att(n: number, entity_type: string, entity_id: string, name: string): AttachmentRow {
    return { id: uid("92", n), entity_type, entity_id, bucket: "ento-files", path: `${DEMO_USER}/${entity_type}/${n}-${name}`, file_name: name, mime_type: "image/jpeg", size_bytes: 180_000, created_at: at(-3) };
  }
}

/** Copies the latest decision onto the job (the v_jobs "last_*" columns). */
export function applyLast(j: JobRow, verifs: VerificationRow[]) {
  const mine = verifs.filter((v) => v.visit_id === j.visit_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const last = mine[mine.length - 1];
  if (!last || j.verification_status === "pending") return;
  Object.assign(j, { last_decision: last.decision, last_note: last.note, last_issue: last.issue, last_verifier_name: last.verifier_name, last_decided_at: last.created_at });
}

export const store: Store = seed();

/* ---------- tables and views, as the screens query them ---------- */
type Row = Record<string, unknown>;

function siteVisitsView(): SiteVisitRow[] {
  return store.visits.map((v) => ({
    ...v,
    new_findings: store.findings.filter((f) => f.found_visit_id === v.id).length,
    fixed_count: store.checks.filter((c) => c.site_visit_id === v.id && c.result === "fixed").length,
    not_fixed_count: store.checks.filter((c) => c.site_visit_id === v.id && c.result === "not_fixed").length,
  }));
}
function findingsView(): FindingRow[] {
  return store.findings.map((f) => {
    const cs = store.checks.filter((c) => c.finding_id === f.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = cs[cs.length - 1];
    const lastVisit = last && store.visits.find((v) => v.id === last.site_visit_id);
    return { ...f, last_result: last?.result ?? null, last_checked_on: lastVisit?.visit_date ?? null, last_checked_by: last?.created_by_name ?? null, times_not_fixed: cs.filter((c) => c.result === "not_fixed").length };
  });
}
function summaryView() {
  return DEMO_SITES.map((s) => {
    const fs = store.findings.filter((f) => f.site_id === s.site_id);
    const vs = store.visits.filter((v) => v.site_id === s.site_id).map((v) => v.visit_date).sort();
    return {
      site_id: s.site_id, site_name: s.site_name, site_city: s.city, client_id: s.client_id, client_name: s.client_name,
      open_count: fs.filter((f) => f.status === "open").length, fixed_count: fs.filter((f) => f.status === "fixed").length,
      visit_count: vs.length, last_visit_date: vs[vs.length - 1] ?? null,
    };
  });
}

export function demoTable(schema: "ento" | "ops", name: string): Row[] {
  if (schema === "ops") return name === "site_issues" ? store.siteIssues : [];
  switch (name) {
    case "v_jobs": return store.jobs;
    case "job_assignments": return store.jobs.filter((j) => j.assignment_id).map((j) => ({ id: j.assignment_id, visit_id: j.visit_id, site_id: j.site_id, verification_status: j.verification_status, assigned_to: j.assigned_to }));
    case "job_verifications": return store.verifs;
    case "v_complaints": case "complaints": return store.complaints;
    case "complaint_updates": return store.updates;
    case "attachments": return store.attachments;
    case "notifications": return store.notifications;
    case "v_my_meetings": return store.meetings;
    case "v_inspection_tasks": case "inspection_tasks": return store.tasks;
    case "v_site_visits": case "site_visits": return siteVisitsView();
    case "v_site_findings": case "site_findings": return findingsView();
    case "finding_checks": return store.checks;
    case "v_finding_checks": return store.checks.map((c) => {
      const v = store.visits.find((x) => x.id === c.site_visit_id);
      return { ...c, site_id: v?.site_id, visit_date: v?.visit_date };
    });
    case "v_site_inspection_summary": return summaryView();
    default: return [];
  }
}

/* ---------- placeholder photos ---------- */
const PHOTO_TONES = ["#5b8def", "#3fa37a", "#d48a2c", "#9b6bd6", "#d0584f", "#3a9bb5"];
/** A labelled placeholder image (SVG data URL) for a stored path. */
export function demoPhoto(path: string): string {
  const part = /\/(before|during|findings|challan)/.exec(path)?.[1] ?? "photo";
  const label = { before: "Before service", during: "During service", findings: "Finding", challan: "Signed challan", photo: "Photo" }[part]!;
  let h = 0;
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = PHOTO_TONES[h % PHOTO_TONES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${c}"/><circle cx="500" cy="120" r="60" fill="#fff" fill-opacity=".25"/><path d="M0 400 L180 240 L320 360 L440 280 L640 420 L640 480 L0 480Z" fill="#000" fill-opacity=".18"/><text x="40" y="80" font-family="system-ui,sans-serif" font-size="40" font-weight="700" fill="#fff">${label}</text><text x="40" y="126" font-family="system-ui,sans-serif" font-size="24" fill="#fff" fill-opacity=".85">Sample photo #${(h % 90) + 10}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
