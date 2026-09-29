import { errorResponse, householdMembers, inviteMember, requireHousehold } from "@/db/storage";
import { googleSheetConfigured } from "@/db/google-sheet";

export const runtime = "nodejs";

/** Confirms household membership (accepting an invitation on first sign-in) and returns who's in it. */
export async function GET(request: Request) {
  try {
    const context = await requireHousehold(request);
    return Response.json({
      householdId: context.householdId,
      role: context.role,
      email: context.user.email || "",
      ...(await householdMembers(context)),
      googleSheet: googleSheetConfigured(),
    });
  } catch (error) {
    return await errorResponse(error, "Unable to open Cardfolio");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== "invite") throw new Response("Unknown action", { status: 400 });
    await inviteMember(context, body.email);
    return Response.json(await householdMembers(context));
  } catch (error) {
    return await errorResponse(error, "Unable to save changes");
  }
}
