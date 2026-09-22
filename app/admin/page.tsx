import { redirect } from "next/navigation";
import AdminPanel from "@/components/AdminPanel";
import AppHeader from "@/components/AppHeader";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <><AppHeader user={user} /><AdminPanel adminId={user.id} /></>;
}
