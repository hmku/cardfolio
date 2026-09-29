import { sendPush } from "@/db/push";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

/** Sends a test notification to the signed-in member's own devices. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { data, error } = await context.db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", context.user.id);
    if (error) throw error;
    if (!data?.length) throw new Response("Turn on reminders on this device first", { status: 400 });
    const delivered = await sendPush(context.db, data, { title: "Cardfolio reminders are on", body: "You'll get a note here when credits or bonus deadlines are coming up." });
    return Response.json({ delivered });
  } catch (error) {
    return await errorResponse(error, "Couldn't send a test notification");
  }
}
