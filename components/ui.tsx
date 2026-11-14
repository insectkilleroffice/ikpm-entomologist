import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`bdg ${tone}`}>{children}</span>;
}

/** Badge from one of the label maps in lib/labels. */
export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string | null | undefined }) {
  const s = (value && map[value]) || { label: value ? value.replace(/_/g, " ") : "—", tone: "gray" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PageHead({ title, sub, crumbs, actions }: {
  title: ReactNode;
  sub?: ReactNode;
  crumbs?: { href: string; label: string }[];
  actions?: ReactNode;
}) {
  return (
    <header className="page-h">
      <div style={{ minWidth: 0 }}>
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                <Link href={c.href}>{c.label}</Link>
                {i < crumbs.length - 1 ? " /" : ""}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="acts">{actions}</div>}
    </header>
  );
}

export function Section({ title, action, children, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="sec" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      {(title || action) && (
        <div className="sec-h">
          {title && <h2 id={id ? `${id}-h` : undefined}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <b>{title}</b>
      {children && <span className="small">{children}</span>}
    </div>
  );
}

/** Shown when a query fails (most often: the ento migrations have not been run yet). */
export function LoadError({ error }: { error: { message?: string; code?: string } | null }) {
  const notSetUp = !!error && (/schema must be one of|does not exist|PGRST106|PGRST205/i.test(`${error.message} ${error.code}`));
  return (
    <p className="err" role="alert">
      {notSetUp
        ? 'The entomologist database is not set up yet. Run the two files in supabase/migrations and add "ento" to Supabase → Settings → API → Exposed schemas.'
        : `Could not load this: ${error?.message ?? "unknown error"}`}
    </p>
  );
}

export function KV({ rows, wide = true }: { rows: [ReactNode, ReactNode][]; wide?: boolean }) {
  return (
    <dl className={`kv${wide ? " wide" : ""}`}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Previous / next links that keep the other search params. */
export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pager" aria-label="Pages">
      <span>
        {from}–{to} of {total}
      </span>
      <span className="row">
        {page > 1 ? <Link className="btn alt sm" href={href(page - 1)}>Previous</Link> : <span className="btn alt sm" aria-disabled="true" style={{ opacity: 0.4 }}>Previous</span>}
        <span>
          Page {page} of {pages}
        </span>
        {page < pages ? <Link className="btn alt sm" href={href(page + 1)}>Next</Link> : <span className="btn alt sm" aria-disabled="true" style={{ opacity: 0.4 }}>Next</span>}
      </span>
    </nav>
  );
}

/** Segmented links (status tabs on list pages). */
export function SegLinks({ items, current, label }: { items: { key: string; label: string; href: string; count?: number }[]; current: string; label: string }) {
  return (
    <div className="seg-w">
      <nav className="seg" aria-label={label}>
        {items.map((i) => (
          <Link key={i.key} href={i.href} aria-current={i.key === current ? "true" : undefined}>
            {i.label}
            {i.count != null && <span className="c">{i.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <span className="skel" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <Skeleton h={28} w={240} />
      <div className="sec">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} h={18} />
        ))}
      </div>
    </div>
  );
}

/** Build a URL from the current search params with some keys replaced (null removes). */
export function withParams(base: string, current: Record<string, string | undefined>, patch: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** First value of a search param. */
export function sp(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v || undefined;
}

/** Keep only characters safe inside a PostgREST or() filter. */
export function safeQuery(q: string | undefined) {
  return (q ?? "").replace(/[^\p{L}\p{N}\s\-_.]/gu, " ").trim().slice(0, 60);
}
