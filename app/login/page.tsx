"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/** Sign-in screen. There is no login backend: any email and password open the portal. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your email and password");
    setLoading(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 300));
    router.replace("/");
  }

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16 }}>
      <form onSubmit={onSubmit} noValidate className="panel" style={{ width: "100%", maxWidth: 380 }}>
        <div className="brand" style={{ margin: 0 }}>
          <b>IKPM Entomologist</b>
          <span>Sign in with your entomologist account</span>
        </div>
        <div className="fld">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn go" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
