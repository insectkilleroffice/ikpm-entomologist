/** Display labels and badge tones for the database enums. */

export type Tone = "red" | "amber" | "green" | "gray" | "blue" | "violet";

export const VERIFICATION: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Needs verification", tone: "red" },
  verified: { label: "Verified", tone: "green" },
  complaint: { label: "Complaint", tone: "violet" },
};

export const JOB_KIND: Record<string, string> = {
  monthly: "Monthly service",
  contract: "Contract service",
  complaint_service: "Complaint service",
};

export const OUTCOME: Record<string, string> = { completed: "Completed", partial: "Partially completed" };

/** What is wrong with a service the entomologist marks as a complaint, and what Operations then does. */
export const COMPLAINT_ISSUE: Record<string, { label: string; action: string }> = {
  service: {
    label: "Service issue",
    action: "Operations marks this site as a complaint and schedules a complaint service. When the PCO completes it, it comes to you to verify.",
  },
  document: {
    label: "Document issue",
    action: "Operations corrects the documents and pictures of this service. The job then comes back to you to verify again.",
  },
};

export const COMPLAINT_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "With Operations", tone: "amber" },
  in_progress: { label: "In progress", tone: "blue" },
  resolved: { label: "Resolved", tone: "green" },
};
export const COMPLAINT_FLOW = ["submitted", "in_progress", "resolved"] as const;
export const COMPLAINT_OPEN = ["submitted", "in_progress"];

/** An inspection Admin assigned to the entomologist; done when the report is submitted. */
export const INSPECTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  assigned: { label: "Report due", tone: "red" },
  submitted: { label: "Report submitted", tone: "green" },
};

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
