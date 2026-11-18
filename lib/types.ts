/** Row shapes of the ento.* views and tables this portal reads. */

export type Me = { id: string; email: string; fullName: string; role: string };

export type SiteRow = {
  site_id: string;
  site_name: string;
  city: string | null;
  address: string | null;
  site_status: string;
  client_id: string;
  client_name: string;
  client_code: string;
  is_primary: boolean;
};

export type Item = { name: string; qty: number | string; unit: string };

export type JobRow = {
  visit_id: string;
  job_code: string | null;
  kind: string;
  visit_status: string;
  visit_date: string;
  visit_time: string;
  treatments: string[];
  visit_note: string | null;
  complaint_id: string | null;
  started_at: string | null;
  before_photos: string[];
  site_id: string;
  site_name: string;
  site_city: string | null;
  site_address: string | null;
  client_id: string;
  client_name: string;
  pco_id: string | null;
  pco_name: string | null;
  pco_phone: string | null;
  crew_names: string[] | null;
  outcome: string | null;
  items: Item[] | null;
  extras: { work: string; charge: number }[] | null;
  findings: string[] | null;
  report_notes: string | null;
  found_photos: string[] | null;
  after_photos: string[] | null;
  challan_no: string | null;
  challan_date: string | null;
  challan_file: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  team_names: string[] | null;
  assignment_id: string | null;
  assigned_to: string | null;
  verification_status: string | null;
  completed_at: string | null;
  round: number | null;
  return_note: string | null;
  last_decision: string | null;
  last_note: string | null;
  last_issue: string | null;
  last_verifier_name: string | null;
  last_decided_at: string | null;
};

/** One decision on a job: verified, or marked as a complaint (service or document issue). */
export type VerificationRow = {
  id: string;
  assignment_id: string;
  visit_id: string;
  round: number;
  decision: "verified" | "complaint";
  issue: "service" | "document" | null;
  note: string | null;
  complaint_id: string | null;
  created_by: string;
  verifier_name: string;
  created_at: string;
};

/** ento.v_inspection_tasks — an inspection Admin assigned to the entomologist; the report is a site visit. */
export type InspectionTaskRow = {
  id: string;
  code: string;
  site_id: string;
  site_name: string;
  site_city: string | null;
  client_id: string;
  client_name: string;
  inspection_date: string;
  inspection_time: string;
  purpose: string;
  instructions: string | null;
  assigned_to: string;
  assigned_by_name: string;
  assigned_at: string;
  status: "assigned" | "submitted";
  site_visit_id: string | null;
  submitted_at: string | null;
};

/** A service the entomologist marked as a complaint; Operations works on it. */
export type ComplaintRow = {
  id: string;
  code: string;
  client_id: string;
  site_id: string;
  visit_id: string;
  issue: "service" | "document";
  description: string;
  status: string;
  created_by: string;
  created_by_name: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  site_name: string;
  client_name: string;
  job_code: string | null;
  job_date: string | null;
  /** Service issue: the complaint service Operations scheduled (once scheduled). */
  service_visit_id: string | null;
  service_job_code: string | null;
  service_date: string | null;
};

export type ComplaintUpdateRow = {
  id: string;
  complaint_id: string;
  kind: "comment" | "status" | "response";
  from_status: string | null;
  to_status: string | null;
  message: string | null;
  created_by: string | null;
  author_name: string;
  author_role: string | null;
  created_at: string;
};

export type MeetingRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  online_link: string | null;
  agenda: string | null;
  status: string;
  cancel_reason: string | null;
  scheduled_by_name: string;
  created_at: string;
  updated_at: string;
  attendance_id: string;
  rsvp: string;
  rsvp_at: string | null;
  attendance: string;
  attendance_at: string | null;
  my_notes: string | null;
};

export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type AttachmentRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

/** A file the browser already uploaded to ento-files, passed to a server action. */
export type UploadedFile = { path: string; name: string; type: string; size: number };

/** A stored file with a short-lived signed link, ready to show. */
export type SignedFile = { path: string; url: string | null; name: string; isPdf: boolean };

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

/** ento.v_site_visits — an entomologist's own visit to a site (the site's visit history). */
export type SiteVisitRow = {
  id: string;
  code: string;
  /** The assigned inspection this visit is the report of. */
  inspection_id: string | null;
  site_id: string;
  site_name: string;
  site_city: string | null;
  client_id: string;
  client_name: string;
  visit_date: string;
  pest_activity: string | null;
  notes: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  new_findings: number;
  fixed_count: number;
  not_fixed_count: number;
};

/** ento.v_site_findings — an issue found on a visit; open until a later visit marks it fixed. */
export type FindingRow = {
  id: string;
  code: string;
  site_id: string;
  site_name: string;
  site_city: string | null;
  client_id: string;
  client_name: string;
  area: string | null;            // location
  description: string;            // observation
  severity: string;               // gap classification
  category: string;
  department: string | null;
  risk: string | null;
  recommendation: string | null;
  responsibility: string | null;
  status: "open" | "fixed";
  found_visit_id: string;
  found_visit_code: string;
  found_on: string;
  fixed_visit_id: string | null;
  fixed_on: string | null;
  fixed_by_name: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  last_result: "fixed" | "not_fixed" | null;
  last_checked_on: string | null;
  last_checked_by: string | null;
  times_not_fixed: number;
};

/** ento.finding_checks — one re-check of a finding on a visit (permanent). */
export type FindingCheckRow = {
  id: string;
  finding_id: string;
  site_visit_id: string;
  result: "fixed" | "not_fixed";
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
};

/** ento.v_finding_checks — a check with its site and visit date (gap report grid). */
export type CheckGridRow = FindingCheckRow & { site_id: string; visit_date: string };

/** ento.v_site_inspection_summary — every branch with its inspection numbers (site_id null: a client with no branch). */
export type SiteSummaryRow = {
  site_id: string | null;
  site_name: string | null;
  site_city: string | null;
  client_id: string;
  client_name: string;
  open_count: number;
  fixed_count: number;
  visit_count: number;
  last_visit_date: string | null;
};
