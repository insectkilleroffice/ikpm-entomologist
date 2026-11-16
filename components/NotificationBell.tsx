"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { markNotificationsRead } from "@/app/actions";
import { fmtAgo } from "@/lib/time";
import type { NotificationRow } from "@/lib/types";
import { ento, LIVE_EVENT, OPEN_EVENT } from "@/lib/client-data";
import { panelFromLink, type Panel } from "./panels";

/** Opens a panel in the planner drawer (the portal is a single page). */
const openPanel = (p: Panel) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: p }));

const BELL = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const db = ento();
    const [list, count] = await Promise.all([
      db.from("notifications").select("id,kind,title,body,link,entity_type,entity_id,read_at,created_at")
        .eq("assigned_to", userId).order("created_at", { ascending: false }).limit(10),
      db.from("notifications").select("id", { count: "exact", head: true }).eq("assigned_to", userId).is("read_at", null),
    ]);
    setFailed(!!list.error);
    if (!list.error) setItems(list.data as NotificationRow[]);
    if (!count.error) setUnread(count.count ?? 0);
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const onChange = (e: Event) => {
      const t = (e as CustomEvent).detail?.table;
      if (t === "notifications" || t === "visibility") load();
    };
    window.addEventListener(LIVE_EVENT, onChange);
    return () => window.removeEventListener(LIVE_EVENT, onChange);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function openItem(n: NotificationRow) {
    setOpen(false);
    if (!n.read_at) {
      setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      markNotificationsRead([n.id]);
    }
    const p = panelFromLink(n.link);
    if (p) openPanel(p);
  }

  async function readAll() {
    setItems((l) => l.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
    await markNotificationsRead();
  }

  return (
    <div className="bell" ref={box}>
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {BELL}
        {unread > 0 && <span className="dot">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label="Notifications">
          <div className="pop-h">
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="link" onClick={readAll}>
                Mark all read
              </button>
            )}
          </div>
          <div className="pop-l">
            {failed && <p className="err" style={{ margin: 12 }}>Could not load notifications.</p>}
            {!failed && !items.length && <p className="empty">You&rsquo;re all caught up.</p>}
            {items.map((n) => (
              <a
                key={n.id}
                href={n.link ?? "#"}
                className={`nt${n.read_at ? "" : " unread"}`}
                onClick={(e) => {
                  e.preventDefault();
                  openItem(n);
                }}
              >
                <i aria-hidden="true" />
                <span style={{ minWidth: 0 }}>
                  <b>{n.title}</b>
                  {n.body && <p>{n.body}</p>}
                  <small>{fmtAgo(n.created_at)}</small>
                </span>
              </a>
            ))}
          </div>
          <div className="pop-f">
            <button type="button" className="link" onClick={() => { setOpen(false); openPanel({ t: "list", id: "notifications" }); }}>
              See all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
