"use client";

import { useMemo, useCallback, useEffect, useState } from "react";
import type { SignedFile } from "@/lib/types";
import { demoPhoto, demoTable } from "@/lib/demo-data";

export const LIVE_EVENT = "ento:change";
/** Ask the planner to open a drawer panel: window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: panel })). */
export const OPEN_EVENT = "ento:open";

// Screens read rows as their own row types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = { data: any; error: { message: string } | null; count: number | null };
type Chain = (...args: unknown[]) => Query;
interface Query extends PromiseLike<Result> {
  select: Chain; eq: Chain; neq: Chain; gt: Chain; gte: Chain; lt: Chain; lte: Chain; is: Chain; in: Chain; not: Chain;
  or: Chain; filter: Chain; ilike: Chain; order: Chain; limit: Chain; range: Chain; maybeSingle: Chain; single: Chain;
}
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

/* ---------- comparisons (timestamps compare as instants, numbers as numbers) ---------- */
const TS = /^\d{4}-\d{2}-\d{2}T/;
function cmp(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string" && TS.test(a) && TS.test(b)) return Date.parse(a) - Date.parse(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number" && typeof b === "string" && b !== "" && !Number.isNaN(Number(b))) return a - Number(b);
  return String(a).localeCompare(String(b));
}
const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));
function likeRe(pattern: string) {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, "[\\s\\S]*");
  return new RegExp("^" + esc + "$", "i");
}

function op(col: string, o: string, v: unknown): Pred {
  return (r) => {
    const x = r[col];
    switch (o) {
      case "eq": return same(x, v);
      case "neq": return x != null && !same(x, v);
      case "gt": return x != null && cmp(x, v) > 0;
      case "gte": return x != null && cmp(x, v) >= 0;
      case "lt": return x != null && cmp(x, v) < 0;
      case "lte": return x != null && cmp(x, v) <= 0;
      case "is": return v === null || v === "null" ? x == null : same(x, v);
      case "in": return Array.isArray(v) && v.some((y) => same(x, y));
      case "ilike": case "like": return x != null && likeRe(String(v)).test(String(x));
      default: return true;
    }
  };
}

/* ---------- PostgREST or() strings: "a.eq.1,and(b.gte.2,c.is.null)" ---------- */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function parseTerm(t: string): Pred {
  const g = /^(and|or)\(([\s\S]*)\)$/.exec(t.trim());
  if (g) {
    const parts = splitTop(g[2]).map(parseTerm);
    return g[1] === "and" ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r));
  }
  const [col, o, ...rest] = t.trim().split(".");
  if (o === "not") {
    const [o2, ...r2] = rest;
    const raw2 = r2.join(".");
    const inner = op(col, o2, raw2 === "null" ? null : raw2);
    return (r) => !inner(r);
  }
  const raw = rest.join(".");
  return op(col, o, raw === "null" ? null : raw);
}

/**
 * Sample data source (lib/demo-data.ts): each query chain (.from().select().eq()…) is run
 * against the in-memory rows, with the same filters, ordering, paging and counts as PostgREST.
 * Replace with a real client when a backend is connected.
 */
function query(schema: "ento" | "ops", table: string): Query {
  const preds: Pred[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let from = 0, to = Infinity, single = false, head = false;

  const run = (): Result => {
    const rows = demoTable(schema, table).filter((r) => preds.every((p) => p(r)));
    // Stable sorts applied last-key-first give a multi-column ORDER BY.
    for (const o of [...orders].reverse()) {
      rows.sort((a, b) => {
        const x = a[o.col], y = b[o.col];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return o.asc ? cmp(x, y) : cmp(y, x);
      });
    }
    const count = rows.length;
    const page = structuredClone(rows.slice(from, to === Infinity ? undefined : to + 1));
    if (head) return { data: null, error: null, count };
    return { data: single ? page[0] ?? null : page, error: null, count };
  };

  const add = (p: Pred) => { preds.push(p); return q; };
  const q: Query = {
    select: (_cols, opts) => { if ((opts as { head?: boolean } | undefined)?.head) head = true; return q; },
    eq: (c, v) => add(op(String(c), "eq", v)),
    neq: (c, v) => add(op(String(c), "neq", v)),
    gt: (c, v) => add(op(String(c), "gt", v)),
    gte: (c, v) => add(op(String(c), "gte", v)),
    lt: (c, v) => add(op(String(c), "lt", v)),
    lte: (c, v) => add(op(String(c), "lte", v)),
    is: (c, v) => add(op(String(c), "is", v)),
    in: (c, v) => add(op(String(c), "in", v)),
    ilike: (c, v) => add(op(String(c), "ilike", v)),
    filter: (c, o, v) => add(op(String(c), String(o), v)),
    not: (c, o, v) => { const p = op(String(c), String(o), v); return add((r) => !p(r)); },
    or: (s) => add(parseTerm(`or(${String(s)})`)),
    order: (c, opts) => { orders.push({ col: String(c), asc: (opts as { ascending?: boolean } | undefined)?.ascending !== false }); return q; },
    limit: (n) => { to = Math.min(to, from + Number(n) - 1); return q; },
    range: (a, b) => { from = Number(a); to = Number(b); return q; },
    maybeSingle: () => { single = true; return q; },
    single: () => { single = true; return q; },
    // A short delay so loading states still show.
    then: (ok, fail) => new Promise<Result>((res) => setTimeout(() => res(run()), 60)).then(ok, fail),
  };
  return q;
}

export const ento = () => ({ from: (table: string) => query("ento", table) });
export const opsDb = () => ({ from: (table: string) => query("ops", table) });

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

/** Viewable links for stored files. Sample data: labelled placeholder images (PDF paths show as PDF tiles). */
export function useSigned(_bucket: "ops-files" | "ento-files", paths: (string | null | undefined)[], names: Record<string, string> = {}): SignedFile[] {
  const key = paths.filter(Boolean).join("|");
  const nameKey = JSON.stringify(names);
  return useMemo(() => {
    const n: Record<string, string> = JSON.parse(nameKey);
    return key.split("|").filter(Boolean).map((p) => {
      const isPdf = p.toLowerCase().endsWith(".pdf");
      return { path: p, name: n[p] ?? p.split("/").pop() ?? "file", isPdf, url: isPdf ? null : demoPhoto(p) };
    });
  }, [key, nameKey]);
}
