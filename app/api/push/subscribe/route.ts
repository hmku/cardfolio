import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

type Body = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

/** Saves this browser's push subscription for the signed-in member. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const body = await request.json() as Body;
    if (!body.endpoint?.startsWith("https://") || !body.keys?.p256dh || !body.keys?.auth) throw new Response("That browser subscription looks incomplete", { status: 400 });
    const { error } = await context.db.from("push_subscriptions").upsert({
      household_id: context.householdId,
      user_id: context.user.id,
      email: context.user.email,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) || null,
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return await errorResponse(error, "Couldn't turn on reminders");
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { endpoint } = await request.json() as Body;
    if (endpoint) {
      const { error } = await context.db.from("push_subscriptions").delete().eq("user_id", context.user.id).eq("endpoint", endpoint);
      if (error) throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return await errorResponse(error, "Couldn't turn off reminders");
  }
}
