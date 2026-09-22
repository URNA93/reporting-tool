"use client";

import Image from "next/image";
import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/auth";

export default function AppHeader({ user }: { user: SessionUser }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <>
      <div className="account-bar">
        <span>{user.name}</span>
        <strong>{user.role === "admin" ? "SPRÁVCE" : user.role === "manager" ? "MANAŽER" : "UŽIVATEL"}</strong>
      </div>
      <header className="app-header">
        <Link href="/" className="brand-link" aria-label="GFS Reporting – přehled">
          <Image src="/gfs-visionary.png" width={242} height={36} alt="GFS Visionary" priority unoptimized />
          <span>REPORTING</span>
        </Link>
        <nav aria-label="Hlavní navigace">
          <Link href="/">Přehled</Link>
          {user.role === "admin" && <Link href="/admin"><Settings /> Správa</Link>}
          <Button variant="ghost" onClick={logout}><LogOut /> Odhlásit</Button>
        </nav>
      </header>
    </>
  );
}
