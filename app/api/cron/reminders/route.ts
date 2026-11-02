import { paymentsDue } from "@/app/lib/core/card-plaid";
import { isoDate } from "@/app/lib/core/dates";
import { loadCardPlaidData } from "@/app/lib/finance-data";
import { indexPortfolio } from "@/app/lib/core/model";
import { dailyReminder, todayInTimeZone } from "@/app/lib/core/reminders";
import { loadPortfolio } from "@/app/lib/data";
import { sendPush } from "@/db/push";
import { adminClient, isCronRequest } from "@/db/storage";

export const runtime = "nodejs";

const TIME_ZONE = process.env.REMINDER_TIME_ZONE || "America/New_York";

/** Daily job (see vercel.json). Vercel calls it with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Not authorized" }, { status: 401 });
  const db = adminClient();
  const today = todayInTimeZone(TIME_ZONE);
  const sentOn = isoDate(today);
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const { data: households, error } = await db.from("households").select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const { id: householdId } of households || []) {
    const portfolio = indexPortfolio(await loadPortfolio(db, householdId));
    // Payments due on Plaid-linked cards. If those can't be loaded, the card reminders still go
    // out and the error is logged and reported here.
    let paymentsError: string | undefined;
    const payments = await loadCardPlaidData({ db, householdId }, { today: sentOn })
      .then((plaid) => paymentsDue(portfolio, plaid, today))
      .catch((reason: unknown) => {
        console.error("Reminders: couldn't load payments due", householdId, reason);
        paymentsError = reason instanceof Error ? reason.message : typeof reason === "object" && reason && "message" in reason ? String(reason.message) : "Couldn't load payments due";
        return [];
      });
    const extra = paymentsError ? { paymentsError } : {};
    const reminder = dailyReminder(portfolio, today, payments);
    if (!reminder) { results.push({ householdId, sent: 0, reason: "nothing due", ...extra }); continue; }
    const { data: logged, error: logError } = await db.from("reminder_log").select("sent_on").eq("household_id", householdId).eq("sent_on", sentOn).maybeSingle();
    if (logError) { results.push({ householdId, sent: 0, error: `Couldn't read the reminder log: ${logError.message}`, ...extra }); continue; }
    if (logged && !force) { results.push({ householdId, sent: 0, reason: "already sent today", ...extra }); continue; }
    const { data: subscriptions, error: subscriptionsError } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("household_id", householdId);
    if (subscriptionsError) { results.push({ householdId, sent: 0, error: `Couldn't load devices: ${subscriptionsError.message}`, ...extra }); continue; }
    const devices = await sendPush(db, subscriptions || [], { title: reminder.title, body: reminder.body, tag: `cardfolio-${sentOn}` });
    const { error: saveError } = await db.from("reminder_log").upsert({ household_id: householdId, sent_on: sentOn, summary: reminder.lines.join("\n"), devices });
    if (saveError) console.error("Reminders: couldn't save the reminder log", householdId, saveError);
    results.push({ householdId, sent: devices, lines: reminder.lines.length, ...extra, ...(saveError ? { logError: saveError.message } : {}) });
  }
  return Response.json({ date: sentOn, results });
}
