"use client";

import { useEffect } from "react";

export default function PortalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="page">
      <div className="sec" role="alert">
        <div className="state">
          <b>Something went wrong</b>
          <span className="small">{msg || "The page could not be loaded."}</span>
          <button type="button" className="btn sm" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
