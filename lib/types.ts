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
  decided_at: string | null;
  last_decision: string | null;
  last_remarks: string | null;
  last_reason: string | null;
  last_verifier_name: string | null;
  last_decided_at: string | null;
};

export type VerificationRow = {
  id: string;
  assignment_id: string;
  visit_id: string;
  round: number;
  decision: string;
  remarks: string | null;
  reason: string | null;
  treatment_ok: boolean | null;
  chemicals_ok: boolean | null;
  photos_ok: boolean | null;
  report_ok: boolean | null;
  pest_activity: string | null;
  created_by: string;
  verifier_name: string;
  created_at: string;
};

export type InspectionRow = {
  visit_id: string;
  site_id: string;
  site_name: string;
  client_id: string;
  client_name: string;
  visit_date: string;
  visit_time: string;
  visit_status: string;
  note: string | null;
  activity: string | null;
  advice: string | null;
  areas: string | null;
  report_notes: string | null;
  written_by_name: string | null;
  written_at: string | null;
};

export type RequestRow = {
  id: string;
  code: string;
  type: "revisit" | "inspection";
  client_id: string;
  site_id: string;
  visit_id: string | null;
  reason: string | null;
  purpose: string | null;
  description: string;
  priority: string;
  recommended_date: string;
  status: string;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  assigned_pco: string | null;
  scheduled_visit_id: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  site_name: string;
  client_name: string;
  prev_job_code: string | null;
  prev_visit_date: string | null;
  scheduled_visit_status: string | null;
  scheduled_job_code: string | null;
  pco_name: string | null;
};

export type ComplaintRow = {
  id: string;
  code: string;
  client_id: string;
  site_id: string;
  visit_id: string | null;
  category: string;
  description: string;
  priority: string;
  status: string;
  created_by: string;
  created_by_name: string;
  assigned_to: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  site_name: string;
  client_name: string;
  job_code: string | null;
  job_date: string | null;
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
