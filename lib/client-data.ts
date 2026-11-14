"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SignedFile } from "@/lib/types";

export const LIVE_EVENT = "ento:change";
/** Ask the planner to open a drawer panel: window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: panel })). */
export const OPEN_EVENT = "ento:open";

/** schema "ento" through the signed-in user's session (row security applies). */
export const ento = () => createClient().schema("ento");
export const opsDb = () => createClient().schema("ops");

/** Unwraps a Supabase response or throws its error. */
export function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** Loads data on mount / when deps change, and again whenever Realtime reports a change. */
export function useQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await run();
      setState({ data, loading: false });
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false }));
    }
  }, [run]);
  useEffect(() => {
    reload();
    const on = () => reload();
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
  }, [reload]);
  return { ...state, reload };
}

/** Short-lived signed links for private files (photos, challans, attachments). */
export function useSigned(bucket: "ops-files" | "ento-files", paths: (string | null | undefined)[], names: Record<string, string> = {}): SignedFile[] {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  const key = list.join("|");
  const [files, setFiles] = useState<SignedFile[]>([]);
  useEffect(() => {
    let live = true;
    const ps = key ? key.split("|") : [];
    if (!ps.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to sign
      setFiles([]);
      return;
    }
    createClient().storage.from(bucket).createSignedUrls(ps, 3600).then(({ data }) => {
      if (!live) return;
      const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
      setFiles(ps.map((p) => ({
        path: p, url: urls.get(p) ?? null, name: p.split("/").pop() ?? "file", isPdf: /\.pdf$/i.test(p),
      })));
    });
    return () => {
      live = false;
    };
  }, [bucket, key]);
  return files.map((f) => ({ ...f, name: names[f.path] ?? f.name }));
}
