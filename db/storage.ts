import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

type MembershipRole = "owner" | "member";

export type HouseholdContext = {
  db: SupabaseClient;
  householdId: string;
  role: MembershipRole;
  user: User;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

export function publicAuthConfig() {
  return {
    url: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

function adminClient() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function normalizeEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export async function requireHousehold(request: Request): Promise<HouseholdContext> {
  const token = bearerToken(request);
  if (!token) throw new Response("Authentication required", { status: 401 });

  const { url, anonKey } = publicAuthConfig();
  const auth = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) throw new Response("Your session has expired", { status: 401 });

  const user = authData.user;
  const email = normalizeEmail(user.email);
  const db = adminClient();
  const membershipResult = await db
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  let membership = membershipResult.data;
  const membershipError = membershipResult.error;
  if (membershipError) throw membershipError;

  if (!membership) {
    const ownerEmail = normalizeEmail(process.env.CARDFOLIO_OWNER_EMAIL);
    const { data: household, error: householdError } = await db
      .from("households")
      .select("id")
      .eq("slug", "primary")
      .single();
    if (householdError) throw householdError;

    let role: MembershipRole | null = null;
    let invitationId: string | null = null;
    if (ownerEmail && email === ownerEmail) {
      role = "owner";
    } else if (email) {
      const { data: invitation, error: invitationError } = await db
        .from("household_invitations")
        .select("id, role")
        .eq("household_id", household.id)
        .eq("email", email)
        .is("accepted_at", null)
        .maybeSingle();
      if (invitationError) throw invitationError;
      if (invitation) {
        role = invitation.role as MembershipRole;
        invitationId = invitation.id;
      }
    }

    if (!role) throw new Response("This email has not been invited to Cardfolio", { status: 403 });
    const { error: insertError } = await db.from("household_members").insert({
      household_id: household.id,
      user_id: user.id,
      email,
      role,
    });
    if (insertError) throw insertError;
    if (invitationId) {
      await db.from("household_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invitationId);
    }
    membership = { household_id: household.id, role };
  }

  return {
    db,
    householdId: membership.household_id,
    role: membership.role as MembershipRole,
    user,
  };
}

export async function readAppData(context: HouseholdContext) {
  const { db, householdId } = context;
  const [accountResult, cardTypeResult, benefitResult, usageResult, actionRuleResult, memberResult, invitationResult, metaResult] = await Promise.all([
    db.from("accounts").select("*, card_types!accounts_card_type_id_fkey(name, issuer)").eq("household_id", householdId).order("approved_on", { ascending: false, nullsFirst: false }).order("id", { ascending: false }),
    db.from("card_types").select("*").eq("household_id", householdId).order("name"),
    db.from("benefits").select("*, card_types!benefits_card_type_id_fkey(name)").eq("household_id", householdId).order("card_type_id").order("name"),
    db.from("benefit_usage").select("*").eq("household_id", householdId),
    db.from("action_rules").select("*").eq("household_id", householdId).order("priority").order("created_at"),
    db.from("household_members").select("user_id, email, role, created_at").eq("household_id", householdId).order("created_at"),
    db.from("household_invitations").select("id, email, role, accepted_at, created_at").eq("household_id", householdId).is("accepted_at", null).order("created_at"),
    db.from("app_meta").select("key, value").eq("household_id", householdId),
  ]);

  for (const result of [accountResult, cardTypeResult, benefitResult, usageResult, actionRuleResult, memberResult, invitationResult, metaResult]) {
    if (result.error) throw result.error;
  }

  const rawAccounts = accountResult.data || [];
  const rawBenefits = benefitResult.data || [];
  const accounts = rawAccounts.map((row) => ({
    id: Number(row.id),
    owner: row.owner,
    cardTypeId: Number(row.card_type_id),
    cardName: row.card_types?.name || "Unknown card",
    issuer: row.card_types?.issuer || "Other",
    kind: row.kind,
    cardIndex: row.card_index,
    appliedOn: row.applied_on,
    approvedOn: row.approved_on,
    openedHow: row.opened_how,
    offer: row.offer,
    bonusAmount: row.bonus_amount,
    spendRequirement: row.spend_requirement === null ? null : Number(row.spend_requirement),
    bonusPeriodMonths: row.bonus_period_months === null ? null : Number(row.bonus_period_months),
    annualFee: Number(row.annual_fee || 0),
    bonusReceived: row.bonus_received ? 1 : 0,
    status: row.status,
    closedOn: row.closed_on,
    closedHow: row.closed_how,
  }));
  const benefits = rawBenefits.map((row) => ({
    id: Number(row.id),
    cardTypeId: Number(row.card_type_id),
    cardName: row.card_types?.name || "Unknown card",
    name: row.name,
    amount: Number(row.amount || 0),
    frequency: row.frequency,
  }));
  const cardTypes = (cardTypeResult.data || []).map((row) => ({
    id: Number(row.id),
    name: row.name,
    issuer: row.issuer,
    kind: row.kind,
    annualFee: Number(row.annual_fee || 0),
    accountCount: accounts.filter((account) => account.cardTypeId === Number(row.id)).length,
    benefitCount: benefits.filter((benefit) => benefit.cardTypeId === Number(row.id)).length,
  }));
  const usages = (usageResult.data || []).map((row) => ({
    id: Number(row.id),
    accountId: Number(row.account_id),
    benefitId: Number(row.benefit_id),
    periodKey: row.period_key,
    used: row.used ? 1 : 0,
    usedOn: row.used_on,
  }));
  const actionRules = (actionRuleResult.data || []).map((row) => ({
    id: row.id,
    name: row.name,
    actionCode: row.action_code,
    priority: Number(row.priority),
    enabled: Boolean(row.enabled),
    conditions: row.conditions || {},
  }));
  const source = Object.fromEntries((metaResult.data || []).map((row) => [row.key, row.value]));

  return {
    accounts,
    cardTypes,
    benefits,
    usages,
    actionRules,
    members: memberResult.data || [],
    invitations: invitationResult.data || [],
    currentUser: { email: context.user.email || "", role: context.role },
    source: {
      spreadsheetId: source.source_spreadsheet_id || "",
      migratedAt: source.migrated_at || "",
    },
  };
}

async function assertCardType(context: HouseholdContext, cardTypeId: number) {
  const { data, error } = await context.db.from("card_types").select("id").eq("household_id", context.householdId).eq("id", cardTypeId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Response("Card type not found", { status: 404 });
}

const ACCOUNT_STATUSES = new Set(["active", "closed", "pending", "declined"]);

function optionalText(value: unknown, maxLength = 500) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalDate(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Response("Enter a valid date", { status: 400 });
  return normalized;
}

function optionalNonnegativeNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Response("Enter a valid nonnegative number", { status: 400 });
  return number;
}

const RULE_NUMBER_FIELDS = ["approvalAgeMin", "approvalAgeMax", "closureAgeMin", "closureAgeMax", "annualFeeMin", "anniversaryBeforeDays", "anniversaryAfterDays"] as const;

function actionRuleConditions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Response("Choose valid rule conditions", { status: 400 });
  const input = value as Record<string, unknown>;
  const conditions: Record<string, unknown> = {};
  if (Array.isArray(input.cardNames)) {
    conditions.cardNames = [...new Set(input.cardNames.map((item) => String(item).trim()).filter(Boolean))].slice(0, 50);
  }
  for (const field of RULE_NUMBER_FIELDS) {
    const number = optionalNonnegativeNumber(input[field]);
    if (number !== null) conditions[field] = number;
  }
  if (conditions.anniversaryBeforeDays !== undefined && Number(conditions.anniversaryBeforeDays) > 364) throw new Response("Anniversary windows must be 364 days or fewer", { status: 400 });
  if (conditions.anniversaryAfterDays !== undefined && Number(conditions.anniversaryAfterDays) > 364) throw new Response("Anniversary windows must be 364 days or fewer", { status: 400 });
  if (input.requiresOpen) conditions.requiresOpen = true;
  if (input.latestCardOnly) conditions.latestCardOnly = true;
  return conditions;
}

function actionRuleValues(body: Record<string, unknown>) {
  const name = optionalText(body.name, 100);
  const actionCode = optionalText(body.actionCode, 24)?.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const priority = optionalNonnegativeNumber(body.priority) ?? 100;
  if (!name) throw new Response("Enter a rule name", { status: 400 });
  if (!actionCode) throw new Response("Enter an action label", { status: 400 });
  return { name, action_code: actionCode, priority, enabled: body.enabled !== false, conditions: actionRuleConditions(body.conditions) };
}

async function updateHouseholdAccount(context: HouseholdContext, accountId: number, values: Record<string, unknown>) {
  const { data, error } = await context.db
    .from("accounts")
    .update(values)
    .eq("household_id", context.householdId)
    .eq("id", accountId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Response("Card account not found", { status: 404 });
}

export async function applyAction(context: HouseholdContext, body: Record<string, unknown>) {
  const { db, householdId } = context;
  const action = String(body.action || "");

  if (action === "createAccount") {
    const cardTypeId = Number(body.cardTypeId);
    await assertCardType(context, cardTypeId);
    const { error } = await db.from("accounts").insert({
      household_id: householdId,
      owner: String(body.owner || "Harrison"),
      card_type_id: cardTypeId,
      kind: String(body.kind || "personal"),
      applied_on: body.appliedOn || null,
      approved_on: body.approvedOn || null,
      opened_how: body.openedHow || "applied",
      offer: body.bonusAmount
        ? [String(body.bonusAmount), body.spendRequirement === "" ? null : `$${Number(body.spendRequirement || 0).toLocaleString("en-US")}`, `${Number(body.bonusPeriodMonths || 3)}mo`].filter(Boolean).join(" / ")
        : null,
      bonus_amount: body.bonusAmount || null,
      spend_requirement: body.bonusAmount && body.spendRequirement !== "" ? Number(body.spendRequirement || 0) : null,
      bonus_period_months: body.bonusAmount ? Number(body.bonusPeriodMonths || 3) : null,
      annual_fee: Number(body.annualFee || 0),
      bonus_received: Boolean(body.bonusReceived),
      status: body.approvedOn ? "active" : "pending",
    });
    if (error) throw error;
  } else if (action === "updateAccount") {
    const accountId = Number(body.accountId);
    const cardTypeId = Number(body.cardTypeId);
    const status = String(body.status || "pending").toLowerCase();
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Response("Card account not found", { status: 404 });
    if (!ACCOUNT_STATUSES.has(status)) throw new Response("Choose a valid card status", { status: 400 });
    await assertCardType(context, cardTypeId);
    const recordsClosure = status === "closed" || status === "declined";
    const closedHow = recordsClosure ? optionalText(body.closedHow, 160) : null;
    if (status === "closed" && !closedHow) throw new Response("Describe how the card was closed", { status: 400 });
    const annualFee = optionalNonnegativeNumber(body.annualFee) ?? 0;
    const spendRequirement = optionalNonnegativeNumber(body.spendRequirement);
    const bonusPeriodMonths = optionalNonnegativeNumber(body.bonusPeriodMonths);
    if (bonusPeriodMonths !== null && bonusPeriodMonths < 1) throw new Response("Bonus period must be at least one month", { status: 400 });
    await updateHouseholdAccount(context, accountId, {
      owner: optionalText(body.owner, 100) || "Harrison",
      card_type_id: cardTypeId,
      kind: optionalText(body.kind, 40) || "personal",
      card_index: optionalText(body.cardIndex, 40),
      applied_on: optionalDate(body.appliedOn),
      approved_on: optionalDate(body.approvedOn),
      opened_how: optionalText(body.openedHow, 160),
      offer: optionalText(body.offer),
      bonus_amount: optionalText(body.bonusAmount, 160),
      spend_requirement: spendRequirement,
      bonus_period_months: bonusPeriodMonths,
      annual_fee: annualFee,
      bonus_received: Boolean(body.bonusReceived),
      status,
      closed_on: recordsClosure ? optionalDate(body.closedOn) || new Date().toISOString().slice(0, 10) : null,
      closed_how: recordsClosure ? closedHow || "Declined" : null,
    });
  } else if (action === "createCardType") {
    const { data, error } = await db.from("card_types").insert({
      household_id: householdId,
      name: String(body.name),
      issuer: String(body.issuer || "Other"),
      kind: String(body.kind || "personal"),
      annual_fee: Number(body.annualFee || 0),
    }).select("id").single();
    if (error) throw error;
    if (body.benefitName) {
      const { error: benefitError } = await db.from("benefits").insert({
        household_id: householdId,
        card_type_id: data.id,
        name: String(body.benefitName),
        amount: Number(body.benefitAmount || 0),
        frequency: String(body.benefitFrequency || "calendar year"),
      });
      if (benefitError) throw benefitError;
    }
  } else if (action === "updateCardType") {
    const cardTypeId = Number(body.cardTypeId);
    await assertCardType(context, cardTypeId);
    const { error } = await db.from("card_types").update({
      name: String(body.name),
      issuer: String(body.issuer || "Other"),
      kind: String(body.kind || "personal"),
      annual_fee: Number(body.annualFee || 0),
    }).eq("household_id", householdId).eq("id", cardTypeId);
    if (error) throw error;
    if (body.benefitName) {
      const { error: benefitError } = await db.from("benefits").insert({
        household_id: householdId,
        card_type_id: cardTypeId,
        name: String(body.benefitName),
        amount: Number(body.benefitAmount || 0),
        frequency: String(body.benefitFrequency || "calendar year"),
      });
      if (benefitError) throw benefitError;
    }
  } else if (action === "closeAccount") {
    const closedOn = optionalDate(body.closedOn);
    const closedHow = optionalText(body.closedHow, 160);
    if (!closedOn) throw new Response("Enter the date the card was closed", { status: 400 });
    if (!closedHow) throw new Response("Describe how the card was closed", { status: 400 });
    await updateHouseholdAccount(context, Number(body.accountId), {
      status: "closed",
      closed_on: closedOn,
      closed_how: closedHow,
    });
  } else if (action === "reopenAccount") {
    await updateHouseholdAccount(context, Number(body.accountId), {
      status: "active",
      closed_on: null,
      closed_how: null,
    });
  } else if (action === "toggleBonus") {
    const { error } = await db.from("accounts").update({
      bonus_received: Boolean(body.received),
    }).eq("household_id", householdId).eq("id", Number(body.accountId));
    if (error) throw error;
  } else if (action === "toggleUsage") {
    const accountId = Number(body.accountId);
    const benefitId = Number(body.benefitId);
    const [{ data: account }, { data: benefit }] = await Promise.all([
      db.from("accounts").select("id").eq("household_id", householdId).eq("id", accountId).maybeSingle(),
      db.from("benefits").select("id").eq("household_id", householdId).eq("id", benefitId).maybeSingle(),
    ]);
    if (!account || !benefit) throw new Response("Credit or account not found", { status: 404 });
    const used = Boolean(body.used);
    const { error } = await db.from("benefit_usage").upsert({
      household_id: householdId,
      account_id: accountId,
      benefit_id: benefitId,
      period_key: String(body.periodKey),
      used,
      used_on: used ? new Date().toISOString().slice(0, 10) : null,
    }, { onConflict: "account_id,benefit_id,period_key" });
    if (error) throw error;
  } else if (action === "createActionRule") {
    const { error } = await db.from("action_rules").insert({
      household_id: householdId,
      ...actionRuleValues(body),
    });
    if (error) throw error;
  } else if (action === "updateActionRule") {
    const ruleId = String(body.ruleId || "");
    const { data, error } = await db.from("action_rules")
      .update({ ...actionRuleValues(body), updated_at: new Date().toISOString() })
      .eq("household_id", householdId)
      .eq("id", ruleId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Response("Action rule not found", { status: 404 });
  } else if (action === "deleteActionRule") {
    const { data, error } = await db.from("action_rules")
      .delete()
      .eq("household_id", householdId)
      .eq("id", String(body.ruleId || ""))
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Response("Action rule not found", { status: 404 });
  } else if (action === "inviteMember") {
    if (context.role !== "owner") throw new Response("Only an owner can add people", { status: 403 });
    const email = normalizeEmail(String(body.email || ""));
    if (!email || !email.includes("@")) throw new Response("Enter a valid email address", { status: 400 });
    const { error } = await db.from("household_invitations").upsert({
      household_id: householdId,
      email,
      role: "member",
      invited_by: context.user.id,
      accepted_at: null,
    }, { onConflict: "household_id,email" });
    if (error) throw error;
  } else {
    throw new Response("Unknown action", { status: 400 });
  }
}
