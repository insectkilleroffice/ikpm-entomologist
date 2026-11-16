"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- UI-only stubs keep their real signatures */

import { useCallback, useEffect, useState } from "react";
import type { SignedFile } from "@/lib/types";

export const LIVE_EVENT = "ento:change";
/** Ask the planner to open a drawer panel: window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: panel })). */
export const OPEN_EVENT = "ento:open";

// Screens read rows as their own row types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = { data: any; error: { message: string } | null; count: number | null };
type Chain = (...args: unknown[]) => EmptyQuery;
interface EmptyQuery extends PromiseLike<Result> {
  select: Chain; eq: Chain; neq: Chain; gt: Chain; gte: Chain; lt: Chain; lte: Chain; is: Chain; in: Chain; not: Chain;
  or: Chain; filter: Chain; ilike: Chain; order: Chain; limit: Chain; range: Chain; maybeSingle: Chain; single: Chain;
}

/**
 * UI only: there is no data source. Every query chain (.from().select().eq()…) resolves
 * to an empty result, so each screen shows its empty state. Connect a backend here.
 */
function emptyQuery(): EmptyQuery {
  let single = false;
  const q = new Proxy({} as EmptyQuery, {
    get(_, key) {
      if (key === "then") {
        return (ok?: (r: Result) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve<Result>({ data: single ? null : [], error: null, count: 0 }).then(ok, fail);
      }
      return () => {
        if (key === "maybeSingle" || key === "single") single = true;
        return q;
      };
    },
  });
  return q;
}

export const ento = () => ({ from: (_table: string) => emptyQuery() });
export const opsDb = () => ({ from: (_table: string) => emptyQuery() });

/** Unwraps a query result or throws its error. */
export function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** Loads data on mount / when deps change, and again whenever LIVE_EVENT fires. */
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

/** Viewable links for stored files. UI only: there are no stored files. */
export function useSigned(_bucket: "ops-files" | "ento-files", _paths: (string | null | undefined)[], _names: Record<string, string> = {}): SignedFile[] {
  return [];
}
