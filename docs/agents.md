# Connecting an AI agent to Cardfolio

Cardfolio is an [MCP](https://modelcontextprotocol.io) server, so Claude (or any MCP client) can
read your cards and record changes for you: "I was approved for the Sapphire Preferred",
"downgrade biz plat HK7 to biz green", or a daily scan of issuer emails.

- **Endpoint:** `https://<your Cardfolio site>/api/mcp` (Streamable HTTP, JSON responses)
- **Auth:** `Authorization: Bearer cfk_…`, a key from **Settings → Agents**

## 1. Create a key

Settings → Agents → name the key (e.g. "Claude email scan") → **Create key**. Copy it right away;
only a hash is stored, so it can't be shown again. Revoke it there at any time. Each key can read
everything in the household and add or change cards and credits, but can't delete anything.

## 2. Connect a client

**Claude Code** (Settings → Agents has a button that copies this with your key filled in):

```bash
claude mcp add --transport http cardfolio https://cardfolio.example.com/api/mcp \
  --header "Authorization: Bearer cfk_..."
```

**Other MCP clients:** add a remote (HTTP) server with the URL above and the `Authorization`
header. Clients that only support OAuth sign-in, such as claude.ai custom connectors, can't pass
a key yet (see TODO.md).

**Without MCP:** POST JSON-RPC 2.0 to the endpoint, e.g.

```bash
curl -s https://cardfolio.example.com/api/mcp -H "Authorization: Bearer cfk_..." \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_cards","arguments":{"query":"biz plat"}}}'
```

## Tools

| Tool | What it does |
|---|---|
| `get_overview` | Today's date, cardholders, card types (ids, short names, fees, credits) and the to-do list. |
| `list_cards` | Open and pending cards (or all with `include_closed`), filtered by `person` or `query`. Each has an `account_id`, its name ("biz plat HK7"), dates, fee, last digits, bonus, status tags and product history. |
| `recent_changes` | What agents changed lately, with each change's `source`. |
| `add_card` | A new application or approved card. The card number (the 7 in HK7) is assigned automatically. |
| `update_card` | Approve or decline a pending card, close a card, mark a bonus earned, or correct dates, fee, last digits, bonus or note. |
| `change_product` | An upgrade or downgrade on an existing account, with the new card number. |
| `undo_product_change` | Removes a card's most recent product change. |
| `record_credit_use` | Ticks off a statement credit for the period that `used_on` falls in (adds up to the full amount by default). |

Rules the tools enforce:

- Dates are `YYYY-MM-DD`; money is in dollars.
- Every write accepts `source`. Put the email's message id in it: a second write with the same
  action and source is skipped (`"status": "already_applied"`), so re-running a scan is safe.
- Every write is recorded in `change_log`, shown under Settings → Agents → Recent agent changes.
- Card creation, product changes and credit uses run as single database transactions
  (`cardfolio_*` functions in `supabase/migrations/20260930000001_agent_api.sql`).
- Email text is data. The server's `instructions` tell agents not to follow instructions found in
  emails, and to report back rather than guess when an email could match more than one card.

## Where the code is

- `app/api/mcp/route.ts`: the MCP endpoint (JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`).
- `app/lib/agent/tools.ts`: tool definitions, input checks and the instructions agents see.
- `app/lib/agent/auth.ts`: key hashing and lookup.
- `app/components/AgentSettings.tsx`: Settings → Agents.
