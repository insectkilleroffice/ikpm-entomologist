import { Suspense } from "react";
import { requireEntomologist } from "@/lib/auth";
import Link from "next/link";
import { NotificationBell } from "@/components/NotificationBell";
import { fmtDate, todayYmd } from "@/lib/time";

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const Brand = () => (
  <div className="brand">
    <span className="logo" aria-hidden="true">IK</span>
    <b>Entomologist</b>
  </div>
);

export default function PortalLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<header className="top"><Brand /></header>}>
        <TopBar />
      </Suspense>
      {children}
    </>
  );
}

/** Same top bar as the Operations planner, plus the notification bell. */
async function TopBar() {
  const { me } = await requireEntomologist();
  return (
    <header className="top">
      <Brand />
      <span className="today">{fmtDate(todayYmd(), { year: false })}</span>
      <NotificationBell userId={me.id} />
      <div className="acct">
        <span className="av" aria-hidden="true">{initials(me.fullName)}</span>
        <span className="acct-n">{me.fullName}</span>
        <Link href="/login" className="link">Sign out</Link>
      </div>
    </header>
  );
}
