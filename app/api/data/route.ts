import { ensureDatabase, readAppData } from "@/db/storage";

export const runtime = "edge";

export async function GET() {
  try {
    return Response.json(await readAppData());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load tracker" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = await ensureDatabase();
    const action = String(body.action || "");

    if (action === "createAccount") {
      await db.prepare(
        `INSERT INTO accounts (
          owner, card_type_id, kind, applied_on, approved_on, opened_how, offer,
          annual_fee, bonus_received, status, closed_on, closed_how
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        String(body.owner || "Harrison"), Number(body.cardTypeId), String(body.kind || "personal"),
        body.appliedOn || null, body.approvedOn || null, body.openedHow || "applied",
        body.offer || null, Number(body.annualFee || 0), body.bonusReceived ? 1 : 0,
        body.approvedOn ? "active" : "pending", null, null,
      ).run();
    } else if (action === "createCardType") {
      const result = await db.prepare(
        "INSERT INTO card_types (name, issuer, kind, annual_fee) VALUES (?, ?, ?, ?)",
      ).bind(String(body.name), String(body.issuer || "Other"), String(body.kind || "personal"), Number(body.annualFee || 0)).run();
      const cardTypeId = Number(result.meta.last_row_id);
      if (body.benefitName) {
        await db.prepare(
          "INSERT INTO benefits (card_type_id, name, amount, frequency) VALUES (?, ?, ?, ?)",
        ).bind(cardTypeId, String(body.benefitName), Number(body.benefitAmount || 0), String(body.benefitFrequency || "calendar year")).run();
      }
    } else if (action === "closeAccount") {
      await db.prepare(
        "UPDATE accounts SET status = 'closed', closed_on = ?, closed_how = ? WHERE id = ?",
      ).bind(String(body.closedOn), String(body.closedHow || "closed"), Number(body.accountId)).run();
    } else if (action === "toggleUsage") {
      const accountId = Number(body.accountId);
      const benefitId = Number(body.benefitId);
      const periodKey = String(body.periodKey);
      const used = body.used ? 1 : 0;
      await db.prepare(
        `INSERT INTO benefit_usage (account_id, benefit_id, period_key, used, used_on)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id, benefit_id, period_key)
         DO UPDATE SET used = excluded.used, used_on = excluded.used_on`,
      ).bind(accountId, benefitId, periodKey, used, used ? new Date().toISOString().slice(0, 10) : null).run();
    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }

    return Response.json(await readAppData());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save changes" }, { status: 500 });
  }
}

