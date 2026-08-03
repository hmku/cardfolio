import { applyAction, readAppData, requireHousehold } from "@/db/storage";

export const runtime = "edge";

async function errorResponse(error: unknown, fallback: string) {
  if (error instanceof Response) {
    return Response.json({ error: (await error.text()) || error.statusText || fallback }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await requireHousehold(request);
    return Response.json(await readAppData(context));
  } catch (error) {
    return await errorResponse(error, "Unable to load tracker");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const body = await request.json() as Record<string, unknown>;
    await applyAction(context, body);
    return Response.json(await readAppData(context));
  } catch (error) {
    return await errorResponse(error, "Unable to save changes");
  }
}
