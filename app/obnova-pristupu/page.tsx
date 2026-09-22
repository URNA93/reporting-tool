import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RecoverAdminPage() {
  if (await getSessionUser()) redirect("/");
  return <AuthForm mode="recover" />;
}
