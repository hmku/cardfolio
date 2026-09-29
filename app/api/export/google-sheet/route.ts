import { exportTables } from "@/app/lib/core/export";
import { indexPortfolio } from "@/app/lib/core/model";
import { loadPortfolio } from "@/app/lib/data";
import { writeGoogleSheet } from "@/db/google-sheet";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

/** Refreshes the read-only Google Sheet copy from the database. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const portfolio = indexPortfolio(await loadPortfolio(context.db, context.householdId));
    await writeGoogleSheet(exportTables(portfolio, new Date()));
    return Response.json({ updatedAt: new Date().toISOString() });
  } catch (error) {
    return await errorResponse(error, "Unable to update the Google Sheet");
  }
}
