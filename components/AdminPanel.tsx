"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, KeyRound, Pencil, RefreshCw, Search, ShieldCheck, UserPlus, UserX } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MANAGED_POSITION_CODES, POSITION_LABELS, type PositionCode } from "@/lib/positions";

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  position: PositionCode;
  role: "admin" | "manager" | "user";
  status: "active" | "disabled";
  requires_password_setup: boolean;
  currentPeriodReports: number;
};
type AdminStats = { currentPeriodReports: number; periodStart: string; periodEnd: string };
type Invitation = {
  id: string;
  email: string;
  name: string;
  position: PositionCode;
  role: "admin" | "manager" | "user";
  invite_token: string;
};
type InvitationDraft = Omit<Invitation, "id" | "invite_token">;

export default function AdminPanel({ adminId }: { adminId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [stats, setStats] = useState<AdminStats>({ currentPeriodReports: 0, periodStart: "", periodEnd: "" });
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ManagedUser | null>(null);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<InvitationDraft>({ name: "", email: "", position: "TM", role: "manager" });
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/admin/users");
    const result = (await response.json().catch(() => ({}))) as { users?: ManagedUser[]; invitations?: Invitation[]; stats?: AdminStats; error?: string };
    if (!response.ok) return setError(result.error || "Uživatele se nepodařilo načíst.");
    setUsers(result.users ?? []);
    setInvitations(result.invitations ?? []);
    if (result.stats) setStats(result.stats);
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/users")
      .then(async (response) => (await response.json()) as { users?: ManagedUser[]; invitations?: Invitation[]; stats?: AdminStats })
      .then((result: { users?: ManagedUser[]; invitations?: Invitation[]; stats?: AdminStats }) => {
        if (!active) return;
        setUsers(result.users ?? []);
        setInvitations(result.invitations ?? []);
        if (result.stats) setStats(result.stats);
      });
    void fetch("/api/admin/sheet-url")
      .then(async (response) => (await response.json()) as { url?: string | null })
      .then((result: { url?: string | null }) => {
        if (active) setSheetUrl(result.url ?? null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("cs-CZ");
    if (!query) return users;
    return users.filter((user) => [user.name, user.email, user.position, POSITION_LABELS[user.position], user.role].join(" ").toLocaleLowerCase("cs-CZ").includes(query));
  }, [search, users]);

  const filteredInvitations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("cs-CZ");
    if (!query) return invitations;
    return invitations.filter((invite) => [invite.name, invite.email, invite.position, POSITION_LABELS[invite.position], invite.role].join(" ").toLocaleLowerCase("cs-CZ").includes(query));
  }, [search, invitations]);

  async function createInvitation() {
    setSaving(true); setError(""); setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inviteForm),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setSaving(false);
    if (!response.ok) return setError(result.error || "Pozvánku se nepodařilo vytvořit.");
    setInviteOpen(false);
    setInviteForm({ name: "", email: "", position: "TM", role: "manager" });
    setMessage(result.message || "Člověk byl přidán a dostane e-mail s odkazem pro nastavení hesla.");
    await load();
  }

  async function copyInvitation(invitation: Invitation) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register?invite=${invitation.invite_token}`);
      setError(""); setMessage(`Registrační odkaz pro ${invitation.name} je zkopírovaný.`);
    } catch {
      setError("Odkaz se nepodařilo zkopírovat. Zkus to znovu.");
    }
  }

  async function revokeInvitation() {
    if (!revokeTarget) return;
    setSaving(true); setError(""); setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationId: revokeTarget.id }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!response.ok) return setError(result.error || "Pozvánku se nepodařilo zrušit.");
    setRevokeTarget(null); setMessage("Pozvánka byla zrušená."); await load();
  }

  async function save() {
    if (!form) return;
    setSaving(true); setError(""); setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: form.id, name: form.name, position: form.position, role: form.role, status: form.status }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!response.ok) return setError(result.error || "Změnu se nepodařilo uložit.");
    setForm(null); setMessage("Jméno, role, pozice a stav účtu byly uloženy."); await load();
  }

  async function resetAccess() {
    if (!resetTarget) return;
    setResetting(true); setError(""); setMessage("");
    const response = await fetch("/api/admin/users/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: resetTarget.id }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setResetting(false);
    if (!response.ok) return setError(result.error || "Obnovu se nepodařilo spustit.");
    setResetTarget(null); setMessage(result.message || "Obnovovací e-mail byl odeslán.");
  }

  async function syncPending() {
    setSyncing(true); setError(""); setMessage("");
    const response = await fetch("/api/admin/sync", { method: "POST" });
    const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setSyncing(false);
    if (!response.ok) return setError(result.error || result.message || "Synchronizace se nepodařila.");
    setMessage(result.message || "Synchronizace je hotová.");
  }

  return (
    <main className="workspace admin-workspace">
      <section className="workspace-title">
        <div><span className="eyebrow"><ShieldCheck /> SPRÁVA SYSTÉMU</span><h1>Lidé a oprávnění</h1><p>Registrace je otevřená pro @gfsgroup.cz. Manažerské role a vyšší pozice přidáváš ručně tady.</p></div>
      </section>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      <section className="admin-summary">
        <article><span>Aktivní účty</span><strong>{users.filter((user) => user.status === "active").length}</strong></article>
        <article><span>Manažeři</span><strong>{users.filter((user) => user.role === "manager").length}</strong></article>
        <article><span>Reporty v období</span><strong>{stats.currentPeriodReports}</strong><small>{stats.periodStart && `${formatDate(stats.periodStart)} – ${formatDate(stats.periodEnd)}`}</small></article>
        {sheetUrl
          ? <a href={sheetUrl} target="_blank" rel="noreferrer"><span>Datová tabulka</span><strong>Otevřít <ExternalLink /></strong></a>
          : <article><span>Datová tabulka</span><strong>Nenastavena</strong></article>}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span>ÚČTY A POZVÁNKY</span><h2>Uživatelé</h2></div><div className="panel-actions"><Button onClick={() => setInviteOpen(true)}><UserPlus /> Přidat člověka</Button><Button variant="outline" onClick={syncPending} disabled={syncing}><RefreshCw />{syncing ? "Zapisuji…" : "Synchronizovat tabulku"}</Button></div></div>
        <div className="admin-search"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hledat jméno, e-mail, pozici nebo roli…" /><span>{filtered.length + filteredInvitations.length} z {users.length + invitations.length}</span></div>
        <Table>
          <TableHeader><TableRow><TableHead>Jméno</TableHead><TableHead>Pozice</TableHead><TableHead>Role</TableHead><TableHead>Stav</TableHead><TableHead>Reporty</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {filteredInvitations.map((invitation) => (
              <TableRow key={`invitation-${invitation.id}`}>
                <TableCell><strong>{invitation.name}</strong><small>{invitation.email}</small></TableCell>
                <TableCell><strong>{invitation.position}</strong><small>{POSITION_LABELS[invitation.position]}</small></TableCell>
                <TableCell>{roleLabel(invitation.role)}</TableCell>
                <TableCell><span className="status-pill invited">Čeká na registraci</span></TableCell>
                <TableCell>—</TableCell>
                <TableCell><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => copyInvitation(invitation)}><Copy /> Kopírovat odkaz</Button><Button variant="ghost" size="sm" onClick={() => setRevokeTarget(invitation)}><UserX /> Zrušit</Button></div></TableCell>
              </TableRow>
            ))}
            {filtered.map((user) => (
              <TableRow key={user.id}>
              <TableCell><strong>{user.name}</strong><small>{user.email}</small></TableCell>
              <TableCell><strong>{user.position}</strong><small>{POSITION_LABELS[user.position]}</small></TableCell>
              <TableCell>{roleLabel(user.role)}</TableCell>
              <TableCell><span className={`status-pill ${user.requires_password_setup ? "invited" : user.status}`}>{user.requires_password_setup ? "Čeká na heslo" : user.status === "active" ? "Aktivní" : "Vypnutý"}</span></TableCell>
              <TableCell>{user.currentPeriodReports}</TableCell>
              <TableCell><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => setForm(user)}><Pencil /> Upravit</Button><Button variant="ghost" size="sm" onClick={() => setResetTarget(user)}><KeyRound /> Nové heslo</Button></div></TableCell>
              </TableRow>
            ))}
            {filtered.length + filteredInvitations.length === 0 && <TableRow><TableCell colSpan={6}>Tomuto hledání neodpovídá žádný účet ani pozvánka.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </section>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Přidat člověka</DialogTitle><DialogDescription>Nastav mu pozici a oprávnění. Po přidání mu rovnou přijde e-mail s bezpečným odkazem; při prvním vstupu si nastaví vlastní heslo.</DialogDescription></DialogHeader>
          <div className="access-form">
            <label>Jméno a příjmení<Input value={inviteForm.name} onChange={(event) => setInviteForm({ ...inviteForm, name: event.target.value })} placeholder="Jan Novák" autoComplete="off" /></label>
            <label>Firemní e-mail<Input type="email" value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} placeholder="jmeno@gfsgroup.cz" autoComplete="off" /></label>
            <label>Pozice<Select value={inviteForm.position} onValueChange={(position) => setInviteForm({ ...inviteForm, position: position as PositionCode })}><SelectTrigger><SelectValue>{inviteForm.position} · {POSITION_LABELS[inviteForm.position]}</SelectValue></SelectTrigger><SelectContent>{MANAGED_POSITION_CODES.map((code) => <SelectItem key={code} value={code}>{code} · {POSITION_LABELS[code]}</SelectItem>)}</SelectContent></Select></label>
            <label>Role<Select value={inviteForm.role} onValueChange={(role) => setInviteForm({ ...inviteForm, role: role as InvitationDraft["role"] })}><SelectTrigger><SelectValue>{roleLabel(inviteForm.role)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="user">Uživatel – jen vlastní reporting</SelectItem><SelectItem value="manager">Manažer – přehled a editace všech lidí</SelectItem><SelectItem value="admin">Správce – plná administrace</SelectItem></SelectContent></Select></label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setInviteOpen(false)}>Zrušit</Button><Button onClick={createInvitation} disabled={saving || inviteForm.name.trim().length < 2 || !inviteForm.email.trim()}>{saving ? "Přidávám…" : "Přidat člověka"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(form)} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upravit uživatele</DialogTitle><DialogDescription>Můžeš upravit jméno, pozici a oprávnění. Firemní e-mail zůstává kvůli přihlášení neměnný.</DialogDescription></DialogHeader>
          {form && <div className="access-form">
            <label>Jméno a příjmení<Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name" /></label>
            <label>Pozice<Select value={form.position} onValueChange={(position) => setForm({ ...form, position: position as PositionCode })}><SelectTrigger><SelectValue>{form.position} · {POSITION_LABELS[form.position]}</SelectValue></SelectTrigger><SelectContent>{MANAGED_POSITION_CODES.map((code) => <SelectItem key={code} value={code}>{code} · {POSITION_LABELS[code]}</SelectItem>)}</SelectContent></Select></label>
            <label>Role<Select value={form.role} onValueChange={(role) => setForm({ ...form, role: role as ManagedUser["role"] })} disabled={form.id === adminId}><SelectTrigger><SelectValue>{roleLabel(form.role)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="user">Uživatel – jen vlastní reporting</SelectItem><SelectItem value="manager">Manažer – přehled a editace všech lidí</SelectItem><SelectItem value="admin">Správce – plná administrace</SelectItem></SelectContent></Select></label>
            <label>Stav<Select value={form.status} onValueChange={(status) => setForm({ ...form, status: status as ManagedUser["status"] })} disabled={form.id === adminId}><SelectTrigger><SelectValue>{form.status === "active" ? "Aktivní" : "Vypnutý"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="active">Aktivní</SelectItem><SelectItem value="disabled">Vypnutý</SelectItem></SelectContent></Select></label>
          </div>}
          <DialogFooter><Button variant="ghost" onClick={() => setForm(null)}>Zrušit</Button><Button onClick={save} disabled={saving}>{saving ? "Ukládám…" : "Uložit změny"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Zrušit pozvánku?</AlertDialogTitle><AlertDialogDescription>Registrační odkaz pro {revokeTarget?.email} přestane fungovat. Později můžeš vytvořit nový.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Ponechat</AlertDialogCancel><AlertDialogAction onClick={revokeInvitation} disabled={saving}>{saving ? "Ruším…" : "Zrušit pozvánku"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(resetTarget)} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Poslat odkaz pro nové heslo?</AlertDialogTitle><AlertDialogDescription>Na {resetTarget?.email} přijde jednorázový obnovovací odkaz. Reporty, role ani pozice se nezmění.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={resetting}>Zrušit</AlertDialogCancel><AlertDialogAction onClick={resetAccess} disabled={resetting}>{resetting ? "Odesílám…" : "Odeslat odkaz"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function roleLabel(role: ManagedUser["role"]) {
  return role === "admin" ? "Správce" : role === "manager" ? "Manažer" : "Uživatel";
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("cs-CZ").format(new Date(`${value}T12:00:00`));
}
