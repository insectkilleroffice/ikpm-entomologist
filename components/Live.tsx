"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LIVE_EVENT } from "@/lib/client-data";

export { LIVE_EVENT };

/**
 * One Supabase Realtime channel for the whole portal. When admin / operations change
 * something that belongs to this entomologist (a newly assigned job, a meeting, a
 * request decision, a complaint reply, a notification), the current page re-renders
 * with fresh server data and client widgets (bell, calendar) are told to refetch.
 * Realtime applies the same row security as normal reads.
 */
export function Live({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (table: string) => {
      window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { table } }));
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const mine = `assigned_to=eq.${userId}`;
    const own = `created_by=eq.${userId}`;
    const ch = supabase
      .channel(`ento-live-${userId}`)
      .on("postgres_changes", { event: "*", schema: "ento", table: "notifications", filter: mine }, () => changed("notifications"))
      .on("postgres_changes", { event: "*", schema: "ento", table: "job_assignments" }, () => changed("job_assignments"))
      .on("postgres_changes", { event: "*", schema: "ento", table: "meeting_attendance", filter: mine }, () => changed("meeting_attendance"))
      .on("postgres_changes", { event: "*", schema: "ento", table: "meetings" }, () => changed("meetings"))
      .on("postgres_changes", { event: "*", schema: "ento", table: "activity_requests", filter: own }, () => changed("activity_requests"))
      .on("postgres_changes", { event: "*", schema: "ento", table: "complaints", filter: own }, () => changed("complaints"))
      .on("postgres_changes", { event: "INSERT", schema: "ento", table: "complaint_updates" }, () => changed("complaint_updates"))
      .subscribe();

    // Also catch up when the tab comes back to the foreground (realtime may have been asleep).
    const onVisible = () => document.visibilityState === "visible" && changed("visibility");
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(ch);
    };
  }, [router, userId]);

  return null;
}
