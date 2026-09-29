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

export async function householdMembers(context: HouseholdContext) {
  const { db, householdId } = context;
  const [members, invitations] = await Promise.all([
    db.from("household_members").select("email, role, created_at").eq("household_id", householdId).order("created_at"),
    db.from("household_invitations").select("email, role, created_at").eq("household_id", householdId).is("accepted_at", null).order("created_at"),
  ]);
  if (members.error) throw members.error;
  if (invitations.error) throw invitations.error;
  return { members: members.data || [], invitations: invitations.data || [] };
}

export async function inviteMember(context: HouseholdContext, rawEmail: unknown) {
  if (context.role !== "owner") throw new Response("Only an owner can add people", { status: 403 });
  const email = normalizeEmail(String(rawEmail || ""));
  if (!email || !email.includes("@")) throw new Response("Enter a valid email address", { status: 400 });
  const { error } = await context.db.from("household_invitations").upsert({
    household_id: context.householdId,
    email,
    role: "member",
    invited_by: context.user.id,
    accepted_at: null,
  }, { onConflict: "household_id,email" });
  if (error) throw error;
}

export async function errorResponse(error: unknown, fallback: string) {
  if (error instanceof Response) {
    return Response.json({ error: (await error.text()) || error.statusText || fallback }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : fallback;
  return Response.json({ error: message }, { status: 500 });
}
