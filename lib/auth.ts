import { connection } from "next/server";
import type { Me } from "@/lib/types";

/** UI only: no login backend. A placeholder user so the top bar renders. */
const ME: Me = { id: "00000000-0000-4000-8000-000000000000", email: "", fullName: "Entomologist", role: "entomologist" };

/** connection() keeps pages request-time (they show "today" in Pakistan time). */
export async function requireEntomologist(): Promise<{ me: Me }> {
  await connection();
  return { me: ME };
}
