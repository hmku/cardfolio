import { publicAuthConfig } from "@/db/storage";

export const runtime = "edge";

export async function GET() {
  try {
    return Response.json(publicAuthConfig());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Authentication is not configured" }, { status: 503 });
  }
}
