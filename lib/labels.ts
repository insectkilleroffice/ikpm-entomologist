/** Display labels and badge tones for the database enums. */

export type Tone = "red" | "amber" | "green" | "gray" | "blue" | "violet";

export const VERIFICATION: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending verification", tone: "amber" },
  verified: { label: "Verified", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  revisit_requested: { label: "Revisit requested", tone: "violet" },
};

export const JOB_KIND: Record<string, string> = {
  monthly: "Monthly service",
  contract: "Contract service",
  revisit: "Revisit",
  inspection: "Inspection",
  meeting: "Meeting",
};

export const VISIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  needs_pco: { label: "Awaiting PCO", tone: "amber" },
  scheduled: { label: "Scheduled", tone: "blue" },
  started: { label: "In progress", tone: "amber" },
  needs_new_day: { label: "Needs new day", tone: "red" },
  done: { label: "Completed", tone: "green" },
};

export const OUTCOME: Record<string, string> = { completed: "Completed", partial: "Partially completed" };

export const COMPLAINT_CATEGORY: Record<string, string> = {
  poor_treatment_quality: "Poor treatment quality",
  pest_activity_present: "Pest activity still present",
  client_dissatisfaction: "Client dissatisfaction",
  pco_performance: "PCO performance",
  chemical_safety: "Chemical / safety issue",
  site_hygiene: "Site hygiene issue",
  report_quality: "Unclear photos / report",
  other: "Other",
};

export const COMPLAINT_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Submitted", tone: "gray" },
  under_review: { label: "Under review", tone: "amber" },
  assigned: { label: "Assigned", tone: "blue" },
  in_progress: { label: "In progress", tone: "blue" },
  resolved: { label: "Resolved", tone: "green" },
  closed: { label: "Closed", tone: "gray" },
};
export const COMPLAINT_FLOW = ["submitted", "under_review", "assigned", "in_progress", "resolved", "closed"] as const;
export const COMPLAINT_OPEN = ["submitted", "under_review", "assigned", "in_progress"];

export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  low: { label: "Low", tone: "gray" },
  medium: { label: "Medium", tone: "blue" },
  high: { label: "High", tone: "amber" },
  critical: { label: "Critical", tone: "red" },
};

export const REQUEST_TYPE: Record<string, string> = { revisit: "Revisit", inspection: "Inspection" };

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Awaiting admin", tone: "amber" },
  approved: { label: "Approved", tone: "blue" },
  rejected: { label: "Rejected", tone: "red" },
  scheduled: { label: "Scheduled", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Withdrawn", tone: "gray" },
};
export const REQUEST_OPEN = ["submitted", "approved", "scheduled"];

export const MEETING_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: "Scheduled", tone: "blue" },
  rescheduled: { label: "Rescheduled", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "red" },
  completed: { label: "Completed", tone: "green" },
};

export const RSVP: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Not confirmed", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  declined: { label: "Declined", tone: "gray" },
};

export const ATTENDANCE: Record<string, string> = { unmarked: "Not marked", attended: "Attended", absent: "Absent" };

export const PEST_ACTIVITY: Record<string, string> = { none: "None", low: "Low", medium: "Medium", high: "High" };

export function lookup<T>(map: Record<string, T>, key: string | null | undefined, fallback: T): T {
  return (key && map[key]) || fallback;
}

export const FINDING_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "amber" },
  fixed: { label: "Fixed", tone: "green" },
};

export const CHECK_RESULT: Record<string, { label: string; tone: Tone }> = {
  fixed: { label: "Fixed", tone: "green" },
  not_fixed: { label: "Not fixed", tone: "red" },
};

export const PEST_TONE: Record<string, Tone> = { none: "green", low: "blue", medium: "amber", high: "red" };

/** Gap report: the finding's section, and its classification / responsibility labels. */
export const FINDING_CATEGORY: Record<string, string> = {
  structural: "Structural gap",
  hygiene: "Hygiene & sanitation gap",
  housekeeping: "Housekeeping & storage gap",
  pest_activity: "Pest activity",
  waste: "Waste management gap",
  other: "Other observations",
};
export const FINDING_CATEGORY_ORDER = ["structural", "hygiene", "housekeeping", "pest_activity", "waste", "other"];

/** Severity shown as the gap classification (same values as priority). */
export const GAP_CLASS: Record<string, { label: string; tone: Tone }> = {
  low: { label: "Low", tone: "gray" },
  medium: { label: "Moderate", tone: "blue" },
  high: { label: "High", tone: "amber" },
  critical: { label: "Severe", tone: "red" },
};

export const RESPONSIBILITY: Record<string, string> = { client: "Client", ikpm: "IKPM", shared: "Client & IKPM" };
