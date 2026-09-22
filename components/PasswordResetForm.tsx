"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function PasswordResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("Hesla se neshodují.");
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/update-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setLoading(false);
    if (!response.ok) return setError(result.error || "Heslo se nepodařilo uložit.");
    router.replace("/");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Nové heslo<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} required autoComplete="new-password" /></label>
      <label>Nové heslo znovu<Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={10} required autoComplete="new-password" /></label>
      {error && <p className="auth-message error">{error}</p>}
      <Button type="submit" disabled={loading}>{loading ? "Ukládám…" : "Uložit nové heslo"}</Button>
    </form>
  );
}
