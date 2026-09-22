import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getSessionUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const token = (await searchParams).invite;
  let invitation: { token: string; email: string; name: string } | undefined;
  if (token && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.rpc("reporting_get_invitation", { p_token: token }).maybeSingle();
    const inviteRecord = data as { email?: string; name?: string } | null;
    if (inviteRecord?.email && inviteRecord.name) invitation = { token, email: inviteRecord.email, name: inviteRecord.name };
  }
  return <AuthForm mode="register" invitation={invitation} invalidInvitation={Boolean(token && !invitation)} />;
}
