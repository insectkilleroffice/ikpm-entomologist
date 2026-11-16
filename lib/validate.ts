import type { ActionResult, UploadedFile } from "@/lib/types";
import { isYmd } from "@/lib/time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

/** Collects field errors; each method returns the cleaned value (or null). Used by the actions. */
export function validator() {
  const errors: Record<string, string> = {};
  const fail = (k: string, m: string) => {
    if (!errors[k]) errors[k] = m;
    return null;
  };
  return {
    errors,
    text(k: string, v: unknown, o: { label: string; required?: boolean; min?: number; max?: number }) {
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) return o.required ? fail(k, `${o.label} is required`) : null;
      if (o.min && s.length < o.min) return fail(k, `${o.label} needs at least ${o.min} characters`);
      if (s.length > (o.max ?? 4000)) return fail(k, `${o.label} is too long (max ${o.max ?? 4000})`);
      return s;
    },
    oneOf<T extends string>(k: string, v: unknown, allowed: readonly T[], label: string, required = true): T | null {
      if (v == null || v === "") return required ? fail(k, `Choose ${label}`) : null;
      return allowed.includes(v as T) ? (v as T) : fail(k, `Choose a valid ${label}`);
    },
    uuid(k: string, v: unknown, label: string, required = true) {
      if (v == null || v === "") return required ? fail(k, `Choose ${label}`) : null;
      return isUuid(v) ? v : fail(k, `Choose a valid ${label}`);
    },
    date(k: string, v: unknown, o: { label: string; required?: boolean; min?: string }) {
      if (v == null || v === "") return o.required ? fail(k, `${o.label} is required`) : null;
      if (!isYmd(v)) return fail(k, `${o.label} is not a valid date`);
      if (o.min && v < o.min) return fail(k, `${o.label} must be today or later`);
      return v;
    },
    files(k: string, v: unknown, userId: string): UploadedFile[] {
      if (v == null) return [];
      if (!Array.isArray(v)) return fail(k, "Invalid attachments") ?? [];
      if (v.length > MAX_FILES) return fail(k, `Attach at most ${MAX_FILES} files`) ?? [];
      const out: UploadedFile[] = [];
      for (const f of v) {
        const ok =
          f && typeof f.path === "string" && f.path.startsWith(`${userId}/`) && !f.path.includes("..") &&
          typeof f.name === "string" && FILE_TYPES.includes(f.type) &&
          Number.isInteger(f.size) && f.size > 0 && f.size <= MAX_FILE_BYTES;
        if (!ok) return fail(k, "One of the attachments is not a valid photo or PDF (max 10 MB)") ?? [];
        out.push({ path: f.path, name: String(f.name).slice(0, 200), type: f.type, size: f.size });
      }
      return out;
    },
    result(): ActionResult<never> | null {
      return Object.keys(errors).length ? { ok: false, error: "Please fix the highlighted fields.", fields: errors } : null;
    },
  };
}
