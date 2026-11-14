import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { signOut } from "@/app/actions";

export const metadata = { title: "No access" };

export default function NoAccess() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, textAlign: "center" }}>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Body />
      </Suspense>
    </main>
  );
}

async function Body() {
  const { me } = await getSession();
  if (!me) redirect("/login");
  if (me.role === "entomologist") redirect("/");
  return (
    <div className="panel" style={{ maxWidth: 420 }}>
      <h2>Entomologists only</h2>
      <p>
        {me.email} {me.role ? `is a ${me.role} account.` : "has no staff profile yet."} This portal is only for
        entomologists.
      </p>
      <form action={signOut}>
        <button className="btn alt">Sign out</button>
      </form>
    </div>
  );
}
