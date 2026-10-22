"use client";

import { CreditCard, LogOut, ShieldCheck, UserRound, Wrench } from "lucide-react";
import { useState } from "react";

export type AccountSettingsUser = {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
};

export type AccountSettingsProps = {
  user: AccountSettingsUser;
  busy: boolean;
  onModels: () => void;
  onSubscription: () => void;
  onSignOut: () => void;
};

export default function AccountSettings({
  user,
  busy,
  onModels,
  onSubscription,
  onSignOut,
}: AccountSettingsProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const displayName = user.name?.trim() || "Your account";
  const initials = (user.name || user.email)
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <main className="content" aria-labelledby="account-settings-title">
      <p className="eyebrow">Account</p>
      <h1 className="title" id="account-settings-title">Account settings</h1>
      <p className="subtitle">Manage your account access and workspace connections.</p>

      <section className="card" style={{ marginTop: 30, maxWidth: 760, padding: 28 }} aria-labelledby="profile-title">
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2 id="profile-title">Profile</h2>
          <UserRound size={20} aria-hidden="true" color="var(--primary)" />
        </div>
        <div className="account-profile" style={{ display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid var(--line)", padding: "5px 0 23px" }}>
          {user.avatarUrl && !photoFailed ? (
            <img className="account-avatar" src={user.avatarUrl} alt="Profile" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} style={{ width: 56, height: 56 }} />
          ) : (
            <span className="account-avatar-fallback" aria-hidden="true" style={{ width: 56, height: 56 }}>{initials}</span>
          )}
          <div>
            <strong style={{ display: "block", fontSize: 17 }}>{displayName}</strong>
            <span className="account-email" style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>{user.email}</span>
          </div>
        </div>
        <p className="small" style={{ margin: "19px 0 0" }}>Your name, email, and profile photo come from your sign-in account. Profile editing is managed by your identity provider.</p>
      </section>

      <section className="card" style={{ marginTop: 16, maxWidth: 760, padding: 28 }} aria-labelledby="workspace-title">
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2 id="workspace-title">Workspace access</h2>
          <ShieldCheck size={20} aria-hidden="true" color="var(--primary)" />
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          {user.isAdmin && <button className="btn" type="button" onClick={onModels}><Wrench size={17} /> Manage calculator workbooks</button>}
          <button className="btn primary" type="button" onClick={onSubscription} disabled={busy}><CreditCard size={17} /> Manage subscription</button>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16, maxWidth: 760, padding: 28 }} aria-labelledby="session-title">
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2 id="session-title">Session</h2>
        </div>
        <p className="small">Sign out of Whittaker Geo on this device.</p>
        <button className="btn" type="button" onClick={onSignOut} disabled={busy} style={{ marginTop: 8 }}><LogOut size={17} /> {busy ? "Signing out…" : "Sign out"}</button>
      </section>
    </main>
  );
}
