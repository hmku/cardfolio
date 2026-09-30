import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

type Subscription = { id: number; endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url?: string; tag?: string };

function configure() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Response("Reminders aren't set up on the server yet", { status: 501 });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:cardfolio@example.com", publicKey, privateKey);
}

/** Sends to each subscription; removes the ones the browser has revoked. Returns how many succeeded. */
export async function sendPush(db: SupabaseClient, subscriptions: Subscription[], message: PushMessage) {
  configure();
  let delivered = 0;
  const gone: number[] = [];
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({ url: "/", ...message }),
        { TTL: 60 * 60 * 12 },
      );
      delivered += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(subscription.id);
      else console.error("Push failed", status, (error as Error).message);
    }
  }));
  if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);
  const sent = subscriptions.filter((subscription) => !gone.includes(subscription.id)).map((subscription) => subscription.id);
  if (sent.length) await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).in("id", sent);
  return delivered;
}
