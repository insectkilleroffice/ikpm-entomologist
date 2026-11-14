"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { checkFiles } from "@/lib/upload";
import { MAX_FILES } from "@/lib/validate";

const PLUS = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/**
 * Photo / PDF picker with previews. On phones the file input offers the camera.
 * Files are kept in the parent form until it is submitted.
 */
export function PhotoPicker({ files, onChange, label = "Photos", hint }: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  hint?: string;
}) {
  const id = useId();
  const [err, setErr] = useState<string | null>(null);
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const problem = checkFiles(next);
    setErr(problem);
    if (!problem) onChange(next);
  }

  return (
    <div className="fld">
      <span className="lb" id={`${id}-l`}>{label}</span>
      <div className="pp" role="group" aria-labelledby={`${id}-l`}>
        {files.map((f, i) => (
          <div className="ft" key={`${f.name}-${i}`}>
            {previews[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previews[i]!} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span className="ft-pdf">PDF</span>
            )}
            <button type="button" className="ft-x" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, k) => k !== i))}>
              ×
            </button>
          </div>
        ))}
        {files.length < MAX_FILES && (
          <label className="ft ft-add" htmlFor={id}>
            <input
              id={id}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
            {PLUS}
            <span>Add</span>
          </label>
        )}
      </div>
      <small>{hint ?? `Up to ${MAX_FILES} photos or PDFs, 10 MB each. On a phone you can take a photo directly.`}</small>
      {err && <span className="ferr" role="alert">{err}</span>}
    </div>
  );
}
