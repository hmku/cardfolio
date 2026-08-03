"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { TrackerApp } from "./TrackerApp";

type AuthConfig = { url: string; anonKey: string };

export function AuthGate() {
  const clientRef = useRef<SupabaseClient | null>(null);
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
        clientRef.current = client;
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
    const client = clientRef.current;
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
    await clientRef.current?.auth.signOut();
  }

  if (checking) {
    return <main className="loading-screen" aria-live="polite"><div className="loading-mark">C</div><p>Opening Cardfolio…</p></main>;
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-brand"><span className="brand-mark">C</span><strong>cardfolio</strong></div>
          <p className="eyebrow">Private portfolio access</p>
          <h1>Welcome back.</h1>
          <p>Enter an authorized email address. We’ll send a one-time sign-in link—no ChatGPT account or password required.</p>
          <form onSubmit={sendMagicLink}>
            <label><span>Email address</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
            <button className="primary-button" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
          {message && <div className="auth-message success" role="status">{message}</div>}
          {error && <div className="auth-message error" role="alert">{error}</div>}
          <small className="auth-footnote">Only invited members can open the shared portfolio.</small>
        </section>
      </main>
    );
  }

  return (
    <TrackerApp
      accessToken={session.access_token}
      userEmail={session.user.email || "Signed-in member"}
      onSignOut={signOut}
    />
  );
}
