/**
 * All dates and times are shown in Pakistan time (Asia/Karachi, UTC+05:00, no DST).
 * Job dates (ops.visits.visit_date) are plain calendar dates with an "HH:MM" local time.
 * Timestamps (created_at, starts_at, …) are timestamptz and converted here for display.
 */
export const TZ = "Asia/Karachi";
const OFFSET = "+05:00";

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of an instant, in Karachi. */
export function karachiYmd(at: Date | string = new Date()): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p; // en-CA formats as YYYY-MM-DD
}

/** HH:MM of an instant, in Karachi. */
export function karachiHm(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** ISO instant h hours before now (request-time helper for queries). */
export function isoHoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

export function todayYmd(): string {
  return karachiYmd(new Date());
}

/** A Karachi wall-clock date + time as an ISO instant. */
export function karachiIso(ymd: string, hm = "00:00"): string {
  return `${ymd}T${hm}:00${OFFSET}`;
}

/** Date-only arithmetic on YYYY-MM-DD strings (calendar maths, no time zone involved). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

/** 0 = Sunday. */
export function weekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function ymdDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Fri 14 Nov 2026" for a YYYY-MM-DD date. */
export function fmtDate(ymd: string | null | undefined, opts: { year?: boolean; weekday?: boolean } = {}): string {
  if (!ymd) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: opts.weekday === false ? undefined : "short",
    day: "numeric",
    month: "short",
    year: opts.year === false ? undefined : "numeric",
  }).format(ymdDate(ymd.slice(0, 10)));
}

/** "14 Nov 2026, 15:30" for a timestamp, in Karachi. */
export function fmtDateTime(at: string | null | undefined): string {
  if (!at) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

/** "3 h ago", "2 d ago" — for notification lists. */
export function fmtAgo(at: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDateTime(at);
}

export function monthTitle(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(ymdDate(ymd));
}

export function dayParts(ymd: string) {
  const d = ymdDate(ymd);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(d);
  return { day: f({ day: "numeric" }), month: f({ month: "short" }), weekday: f({ weekday: "short" }), long: f({ weekday: "long" }) };
}

export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
