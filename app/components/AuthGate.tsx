"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { Portfolio } from "./Portfolio";

type AuthConfig = { url: string; anonKey: string };

export function AuthGate() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    fetch("/api/auth-config")
      .then(async (response) => {
        const config = await response.json() as AuthConfig & { error?: string };
        if (!response.ok) throw new Error(config.error || "Authentication is not configured");
        const client = createClient(config.url, config.anonKey);
        if (active) setClient(client);
        const { data } = await client.auth.getSession();
        if (active) {
          setSession(data.session);
          setChecking(false);
        }
        const listener = client.auth.onAuthStateChange((_event, nextSession) => {
          if (active) setSession(nextSession);
        });
        unsubscribe = () => listener.data.subscription.unsubscribe();
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Authentication is not configured");
          setChecking(false);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setSending(true);
    setError("");
    setMessage("");
    const { error: signInError } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (signInError) setError(signInError.message);
    else setMessage("Check your email for a secure sign-in link.");
    setSending(false);
  }

  async function signOut() {
    await client?.auth.signOut();
  }

  if (checking) {
    return <main className="loading-screen" aria-live="polite"><p>Opening Cardfolio…</p></main>;
  }

  if (!session || !client) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <h1>Cardfolio</h1>
          <p>Enter your email and we&apos;ll send a one-time sign-in link. Only invited people can open the shared portfolio.</p>
          <form onSubmit={sendMagicLink}>
            <label className="f" htmlFor="email">Email address
              <input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </label>
            <button className="btn primary" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
          {message && <div className="auth-message success" role="status">{message}</div>}
          {error && <div className="auth-message error" role="alert">{error}</div>}
        </section>
      </main>
    );
  }

  return <Portfolio db={client} accessToken={session.access_token} onSignOut={signOut} />;
}
