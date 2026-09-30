import { todayInTimeZone } from "@/app/lib/core/reminders";
import { agentFromRequest } from "@/app/lib/agent/auth";
import { INSTRUCTIONS, TOOLS, ToolError, type AgentContext } from "@/app/lib/agent/tools";
import { adminClient } from "@/db/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cardfolio as an MCP server (Streamable HTTP, stateless JSON responses).
 * Authenticate with `Authorization: Bearer cfk_…`, a key made in Settings → Agents.
 */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const TIME_ZONE = process.env.REMINDER_TIME_ZONE || "America/New_York";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });

async function handle(context: AgentContext, message: RpcRequest) {
  const { id, method, params = {} } = message;
  switch (method) {
    case "initialize": {
      const requested = String(params.protocolVersion || "");
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cardfolio", title: "Cardfolio", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((item) => item.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool ${String(params.name)}`);
      try {
        const result = await tool.run(context, (params.arguments as Record<string, unknown>) || {});
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
      } catch (error) {
        const text = error instanceof ToolError || error instanceof Error ? error.message : "Something went wrong.";
        return rpcResult(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: Request) {
  const db = adminClient();
  const agent = await agentFromRequest(db, request);
  if (!agent) {
    return Response.json(rpcError(null, -32001, "Cardfolio needs an agent key: Authorization: Bearer cfk_… (create one in Settings → Agents)."), {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="cardfolio"' },
    });
  }
  let body: RpcRequest | RpcRequest[];
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const context: AgentContext = { db, householdId: agent.householdId, keyName: agent.keyName, today: todayInTimeZone(TIME_ZONE) };
  const messages = Array.isArray(body) ? body : [body];
  const replies = [];
  for (const message of messages) {
    // Notifications (no id) get no reply.
    if (message.id === undefined || message.id === null) continue;
    replies.push(await handle(context, message));
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

export async function GET() {
  return new Response("Cardfolio MCP server: send JSON-RPC with POST.", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
