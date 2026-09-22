import Image from "next/image";
import { redirect } from "next/navigation";
import PasswordResetForm from "@/components/PasswordResetForm";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const user = await getSessionUser({ allowPasswordSetup: true });
  if (!user) redirect("/login");
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand"><Image src="/visionary-favicon-192.png" width={48} height={48} alt="GFS Visionary" unoptimized /><span>GFS VISIONARY<br />REPORTING</span></div>
        <div className="auth-copy"><h1>{user.requiresPasswordSetup ? "Dokonči první přihlášení." : "Nastav nové heslo."}</h1><p>{user.requiresPasswordSetup ? "Nejdřív si nastav vlastní heslo. Pak se dostaneš do reportingu." : "Odkaz je jednorázový. Heslo se ukládá bezpečně v Supabase Auth."}</p></div>
        <PasswordResetForm />
      </section>
    </main>
  );
}
