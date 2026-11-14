"use client";

import { useEffect, useState } from "react";
import type { SignedFile } from "@/lib/types";

/** Thumbnails of stored photos (signed links). Tap to view full size; PDFs open in a new tab. */
export function Photos({ files, label }: { files: SignedFile[]; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!files.length) return <p className="note">No {label.toLowerCase()}.</p>;
  const cur = open !== null ? files[open] : null;

  return (
    <>
      <div className="ths">
        {files.map((f, i) =>
          f.isPdf ? (
            <a key={f.path} className="th" href={f.url ?? "#"} target="_blank" rel="noreferrer" aria-label={`Open ${f.name}`}>
              <span className="th-pdf">PDF</span>
            </a>
          ) : (
            <button key={f.path} type="button" className="th" onClick={() => setOpen(i)} aria-label={`Open ${label} ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {f.url ? <img src={f.url} alt="" loading="lazy" /> : <span className="th-pdf">?</span>}
            </button>
          ),
        )}
      </div>
      {cur && cur.url && (
        <div className="viewer" role="dialog" aria-modal="true" aria-label={label}>
          <div className="vw-scrim" onClick={() => setOpen(null)} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="vw-img" src={cur.url} alt={`${label} ${open! + 1}`} />
          <p className="vw-cap">
            {label} {open! + 1} of {files.length}
          </p>
          <button type="button" className="vw-x" onClick={() => setOpen(null)} aria-label="Close photo" autoFocus>
            ×
          </button>
        </div>
      )}
    </>
  );
}
