"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- UI-only stubs keep their real signatures */

import type { UploadedFile } from "@/lib/types";
import { FILE_TYPES, MAX_FILE_BYTES, MAX_FILES } from "@/lib/validate";

/** Client-side check of picked files. */
export function checkFiles(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files`;
  for (const f of files) {
    if (!FILE_TYPES.includes(f.type)) return `${f.name}: use a JPEG, PNG, WebP, HEIC photo or a PDF`;
    if (f.size > MAX_FILE_BYTES) return `${f.name} is larger than 10 MB`;
  }
  return null;
}

/** UI only: files are not stored anywhere; this just describes them for the action. */
export async function uploadFiles(userId: string, folder: string, files: File[]): Promise<UploadedFile[]> {
  return files.map((f) => ({
    path: `${userId}/${folder}/${f.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file"}`,
    name: f.name, type: f.type, size: f.size,
  }));
}

/** Nothing to remove (no storage). */
export async function removeUploads(_paths: string[]) {}
