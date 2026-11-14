import { Suspense } from "react";
import { requireEntomologist } from "@/lib/auth";
import { LoadError } from "@/components/ui";
import { Calendar } from "@/components/Calendar";
import type { SiteRow } from "@/lib/types";

/** The whole portal is this one planner page; details open in its slide-in drawer. */
export default function PlannerPage() {
  return (
    <Suspense fallback={<p className="empty">Loading…</p>}>
      <Planner />
    </Suspense>
  );
}

async function Planner() {
  const { me, db } = await requireEntomologist();
  const sites = await db.from("v_sites").select("site_id,site_name,city,client_id,client_name").order("client_name").order("site_name");
  if (sites.error) return <div className="page"><LoadError error={sites.error} /></div>;
  return <Calendar userId={me.id} sites={sites.data as SiteRow[]} />;
}
