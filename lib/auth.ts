import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

/**
 * The signed-in user and their staff profile, read once per request.
 * getClaims() verifies the session token locally with the project's signing keys.
 * Row security in the database is the real gate; these checks only decide what to render.
 */
export const getSession = cache(async (): Promise<{ supabase: SupabaseClient; me: Me | null }> => {
  // Everything after this is request-time (it reads the session and "today" in Pakistan time),
  // so it must never be prerendered — same as the Operations and Admin portals.
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return { supabase, me: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", claims.sub)
    .maybeSingle();

  const email = typeof claims.email === "string" ? claims.email : (profile?.email ?? "");
  return {
    supabase,
    me: { id: claims.sub, email, fullName: profile?.full_name || email, role: profile?.role ?? "" },
  };
});

/** For pages: signed-in entomologists only (others are sent to /login or /no-access). */
export async function requireEntomologist() {
  const { supabase, me } = await getSession();
  if (!me) redirect("/login");
  if (me.role !== "entomologist") redirect("/no-access");
  return { supabase, me, db: supabase.schema("ento"), ops: supabase.schema("ops") };
}
