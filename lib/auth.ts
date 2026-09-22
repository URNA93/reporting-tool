import type { PositionCode } from "@/lib/positions";
import { cookies } from "next/headers";
import { migrateLegacyDataForUser } from "@/lib/legacy-migration";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "cloudflare:workers";

const runtimeEnv = env as unknown as Record<string, string | undefined>;

export const MASTER_ADMIN_EMAIL = String(runtimeEnv.REPORTING_MASTER_ADMIN_EMAIL ?? "")
  .trim()
  .toLowerCase();
export const COMPANY_DOMAIN = String(runtimeEnv.REPORTING_COMPANY_DOMAIN ?? "")
  .trim()
  .toLowerCase();

export type AccessRole = "admin" | "manager" | "user";
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  position: PositionCode;
  role: AccessRole;
  status: "active" | "disabled";
  requiresPasswordSetup: boolean;
  canViewAll: boolean;
  canManageReports: boolean;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isCompanyEmail(value: string) {
  if (!/^@[^@\s]+\.[^@\s]+$/.test(COMPANY_DOMAIN)) return false;
  return normalizeEmail(value).endsWith(COMPANY_DOMAIN) && !normalizeEmail(value).startsWith("@");
}

export function isMasterAdminEmail(value: string) {
  return normalizeEmail(value) === MASTER_ADMIN_EMAIL;
}

export function isAllowedLoginEmail(value: string) {
  return isCompanyEmail(value) || isMasterAdminEmail(value);
}

export async function getSessionUser(options: { allowPasswordSetup?: boolean } = {}): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));
  if (!hasAuthCookie) return null;

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const authUser = authData.user;
  if (authError || !authUser?.email || !isAllowedLoginEmail(authUser.email)) return null;

  let { data: profile } = await supabase
    .from("reporting_profiles")
    .select("id,email,name,position,role,status,legacy_migrated_at,requires_password_setup")
    .eq("id", authUser.id)
    .maybeSingle();

  if (!profile) {
    const name = String(authUser.user_metadata?.name || authUser.email.split("@")[0]);
    const position = String(authUser.user_metadata?.position || "T");
    const claimed = await supabase.rpc("reporting_claim_profile", {
      p_name: name,
      p_position: ["T", "FC", "FS", "HFC"].includes(position) ? position : "T",
    });
    profile = claimed.data;
  }
  if (!profile || profile.status !== "active") return null;
  if (profile.requires_password_setup && !options.allowPasswordSetup) return null;

  if (!profile.legacy_migrated_at) {
    await migrateLegacyDataForUser(supabase, authUser.id, authUser.email).catch(() => undefined);
  }

  const role = profile.role as AccessRole;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    position: profile.position as PositionCode,
    role,
    status: profile.status,
    requiresPasswordSetup: Boolean(profile.requires_password_setup),
    canViewAll: role === "manager" || role === "admin",
    canManageReports: role === "manager" || role === "admin",
  };
}

export function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function hasValidOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
