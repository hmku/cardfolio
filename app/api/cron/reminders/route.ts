import { isoDate } from "@/app/lib/core/dates";
import { indexPortfolio } from "@/app/lib/core/model";
import { dailyReminder, todayInTimeZone } from "@/app/lib/core/reminders";
import { loadPortfolio } from "@/app/lib/data";
import { sendPush } from "@/db/push";
import { adminClient } from "@/db/storage";

export const runtime = "nodejs";

const TIME_ZONE = process.env.REMINDER_TIME_ZONE || "America/New_York";

/** Daily job (see vercel.json). Vercel calls it with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not authorized" }, { status: 401 });
  }
  const db = adminClient();
  const today = todayInTimeZone(TIME_ZONE);
  const sentOn = isoDate(today);
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const { data: households, error } = await db.from("households").select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const { id: householdId } of households || []) {
    const reminder = dailyReminder(indexPortfolio(await loadPortfolio(db, householdId)), today);
    if (!reminder) { results.push({ householdId, sent: 0, reason: "nothing due" }); continue; }
    const { data: logged } = await db.from("reminder_log").select("sent_on").eq("household_id", householdId).eq("sent_on", sentOn).maybeSingle();
    if (logged && !force) { results.push({ householdId, sent: 0, reason: "already sent today" }); continue; }
    const { data: subscriptions } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("household_id", householdId);
    const devices = await sendPush(db, subscriptions || [], { title: reminder.title, body: reminder.body, tag: `cardfolio-${sentOn}` });
    await db.from("reminder_log").upsert({ household_id: householdId, sent_on: sentOn, summary: reminder.lines.join("\n"), devices });
    results.push({ householdId, sent: devices, lines: reminder.lines.length });
  }
  return Response.json({ date: sentOn, results });
}
