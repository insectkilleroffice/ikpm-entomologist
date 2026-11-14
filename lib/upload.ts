"use client";

import { createClient } from "@/lib/supabase/client";
import type { UploadedFile } from "@/lib/types";
import { FILE_TYPES, MAX_FILE_BYTES, MAX_FILES } from "@/lib/validate";

/** Client-side check before uploading (the server and the bucket check again). */
export function checkFiles(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files`;
  for (const f of files) {
    if (!FILE_TYPES.includes(f.type)) return `${f.name}: use a JPEG, PNG, WebP, HEIC photo or a PDF`;
    if (f.size > MAX_FILE_BYTES) return `${f.name} is larger than 10 MB`;
  }
  return null;
}

/**
 * Uploads straight from the browser (or phone) to the private "ento-files" bucket,
 * under the user's own folder, so large photos never pass through a server action.
 * The returned paths are then attached to the record by the database function.
 */
export async function uploadFiles(userId: string, folder: string, files: File[]): Promise<UploadedFile[]> {
  if (!files.length) return [];
  const supabase = createClient();
  const done: UploadedFile[] = [];
  try {
    for (const f of files) {
      const safe = f.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file";
      const path = `${userId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
      const { error } = await supabase.storage.from("ento-files").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw new Error(`${f.name}: ${error.message}`);
      done.push({ path, name: f.name, type: f.type, size: f.size });
    }
    return done;
  } catch (e) {
    await removeUploads(done.map((d) => d.path));
    throw e;
  }
}

/** Removes uploads that were never attached (e.g. the form failed to save). */
export async function removeUploads(paths: string[]) {
  if (!paths.length) return;
  await createClient().storage.from("ento-files").remove(paths).catch(() => undefined);
}
