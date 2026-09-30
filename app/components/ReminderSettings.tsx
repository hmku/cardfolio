"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "unsupported" | "install" | "denied" | "off" | "on";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) || navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Turns reminder notifications on or off for this browser or phone. */
export function ReminderSettings({ accessToken, notify }: { accessToken: string; notify: (text: string, error?: boolean) => void }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return isIos() && !isInstalled() ? "install" : "unsupported";
      }
      if (Notification.permission === "denied") return "denied";
      const existing = await (await registration()).pushManager.getSubscription();
      return existing ? "on" : "off";
    })().then((value: Status) => active && setStatus(value), () => active && setStatus("unsupported"));
    return () => { active = false; };
  }, []);

  const call = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(path, { method, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Something went wrong");
    return payload;
  };

  async function turnOn() {
    setBusy(true);
    try {
      if (!VAPID_KEY) throw new Error("Reminders aren't set up on the server yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "denied" : "off"); return; }
      const reg = await registration();
      const subscription = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) });
      await call("/api/push/subscribe", "POST", subscription.toJSON());
      setStatus("on");
      notify("Reminders are on for this device");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't turn on reminders", true);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const subscription = await (await registration()).pushManager.getSubscription();
      if (subscription) {
        await call("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setStatus("off");
      notify("Reminders are off for this device");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't turn off reminders", true);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const { delivered } = await call("/api/push/test", "POST");
      notify(delivered ? "Test sent. It should appear in a few seconds." : "No device received it. Try turning reminders off and on.", !delivered);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't send a test", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fieldset settings-section">
      <h3>Notifications</h3>
      <p className="hint">
        A notification around 9am when a credit is ending (7 days out, 2 days out and on its last day),
        when a bonus deadline is 30, 14 or 3 days away, and when a review rule starts. Mondays bring a summary.
      </p>
      {status === "install" && <p className="hint">On iPhone, add Cardfolio to your home screen first (Share → Add to Home Screen), open it from there, then turn reminders on.</p>}
      {status === "unsupported" && <p className="hint">This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari on a Mac, or the home-screen app on iPhone.</p>}
      {status === "denied" && <p className="hint">Notifications are blocked for this site. Allow them in your browser or phone settings, then come back here.</p>}
      {(status === "off" || status === "on") && (
        <div className="inline-actions">
          {status === "off"
            ? <button type="button" className="btn small primary" disabled={busy} onClick={() => void turnOn()}>Turn on for this device</button>
            : <>
                <span className="tag ok">On for this device</span>
                <button type="button" className="btn small" disabled={busy} onClick={() => void test()}>Send a test</button>
                <button type="button" className="btn small" disabled={busy} onClick={() => void turnOff()}>Turn off</button>
              </>}
        </div>
      )}
    </section>
  );
}
