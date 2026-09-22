"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  POSITION_LABELS,
  SELF_REGISTRATION_POSITION_CODES,
  type SelfRegistrationPositionCode,
} from "@/lib/positions";

export default function AuthForm({
  mode,
  invitation,
  invalidInvitation = false,
}: {
  mode: "login" | "register" | "recover";
  invitation?: { token: string; email: string; name: string };
  invalidInvitation?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [position, setPosition] = useState<SelfRegistrationPositionCode>("T");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const data = new FormData(event.currentTarget);
      const payload = Object.fromEntries(data.entries());
      const endpoint = mode === "recover" ? "recover-admin" : mode;
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        requiresConfirmation?: boolean;
        requiresPasswordSetup?: boolean;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Server požadavek nedokončil. Zkus to prosím znovu.");
      }
      if (mode === "recover" || result.requiresConfirmation) {
        setSuccess(result.message ?? "Hotovo. Zkontroluj firemní e-mail.");
      } else if (mode === "login" && result.requiresPasswordSetup) {
        window.location.href = "/nastavit-heslo";
      } else {
        window.location.href = "/";
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Spojení se serverem se nepovedlo.");
    } finally {
      setLoading(false);
    }
  }

  const isRegister = mode === "register";
  const isRecover = mode === "recover";
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <Image src="/visionary-favicon-192.png" width={48} height={48} alt="GFS Visionary" priority unoptimized />
          <span>GFS VISIONARY<br />REPORTING</span>
        </div>
        <div className="auth-copy">
          <div className="eyebrow"><LockKeyhole /> INTERNÍ APLIKACE</div>
          <h1 id="auth-title">
            {isRegister ? "Nastav si přístup." : isRecover ? "Nastav nové heslo." : "Vítej zpátky."}
          </h1>
          <p>
            {isRegister
              ? "Registrace je otevřená pro firemní e-mail @gfsgroup.cz. Po potvrzení e-mailu se můžeš přihlásit."
              : isRecover
                ? "Pošleme ti bezpečný jednorázový odkaz pro nastavení nového hesla."
              : "Přihlas se firemním e-mailem a heslem."}
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {isRegister && (
            <>
              <label>
                Jméno a příjmení
                <Input name="name" autoComplete="name" required minLength={2} placeholder="Jan Novák" defaultValue={invitation?.name} readOnly={Boolean(invitation)} />
              </label>
              {invitation ? (
                <div className="invitation-note">
                  <strong>Pozvánka správce</strong>
                  <span>Pozici a oprávnění už máš nastavené.</span>
                  <input type="hidden" name="position" value="T" />
                  <input type="hidden" name="invitationToken" value={invitation.token} />
                </div>
              ) : (
                <label>
                  Pozice
                  <input type="hidden" name="position" value={position} />
                  <Select value={position} onValueChange={(value) => setPosition(value as SelfRegistrationPositionCode)}>
                    <SelectTrigger><SelectValue>{position} · {POSITION_LABELS[position]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {SELF_REGISTRATION_POSITION_CODES.map((code) => (
                        <SelectItem key={code} value={code}>{code} · {POSITION_LABELS[code]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
            </>
          )}
          <label>
            Firemní e-mail
            <Input name="email" type="email" autoComplete="email" required placeholder="jmeno@gfsgroup.cz" defaultValue={invitation?.email} readOnly={Boolean(invitation)} />
          </label>
          {!isRecover && (
            <label>
              Heslo
              <Input
                name="password"
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                minLength={isRegister ? 10 : 1}
                placeholder={isRegister ? "Nejméně 10 znaků" : "Tvoje heslo"}
              />
            </label>
          )}
          {invalidInvitation && <p className="auth-message error" role="alert">Tahle pozvánka už neplatí. Požádej správce o novou.</p>}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {success && <p className="auth-message success" role="status">{success}</p>}
          <Button type="submit" size="lg" disabled={loading}>
            {loading
              ? "Ověřuji…"
              : isRegister
                ? "Vytvořit účet"
                : isRecover
                  ? "Poslat odkaz"
                  : "Přihlásit se"}
            {!loading && <ArrowRight />}
          </Button>
        </form>
        <p className="auth-switch">
          {isRecover ? "Zpět k přihlášení?" : isRegister ? "Účet už máš?" : "Ještě nemáš účet?"}{" "}
          <Link href={isRegister || isRecover ? "/login" : "/register"}>
            {isRegister || isRecover ? "Přihlásit se" : "Vytvořit účet"}
          </Link>
        </p>
        {mode === "login" && (
          <p className="auth-switch auth-secondary-link">
            Zapomenuté heslo? <Link href="/obnova-pristupu">Obnovit přístup</Link>
          </p>
        )}
      </section>
    </main>
  );
}
