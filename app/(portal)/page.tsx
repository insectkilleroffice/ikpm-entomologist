import { Suspense } from "react";
import { requireEntomologist } from "@/lib/auth";
import { Calendar } from "@/components/Calendar";
import { DEMO_SITES } from "@/lib/demo-data";

/** The whole portal is this one planner page; details open in its slide-in drawer. */
export default function PlannerPage() {
  return (
    <Suspense fallback={<p className="empty">Loading…</p>}>
      <Planner />
    </Suspense>
  );
}

async function Planner() {
  const { me } = await requireEntomologist();
  return <Calendar userId={me.id} sites={DEMO_SITES} />;
}
