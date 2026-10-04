"use client";

import { useEffect, useState } from "react";
import { KeyRound, LogIn, LogOut, MailCheck, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import {
  changePassword, confirmEmail, confirmPasswordReset, deleteAccount, getCurrentUser,
  loginAccount, logoutAccount, registerAccount, requestPasswordReset, resendVerification,
  type AccountUser,
} from "@/lib/api";
import { editor } from "@/state/store";

type AuthMode = "login" | "register" | "forgot" | "reset";

export function AccountButton() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [resetToken, setResetToken] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const verification = url.searchParams.get("verify");
    const reset = url.searchParams.get("reset");
    if (verification || reset) {
      url.searchParams.delete("verify"); url.searchParams.delete("reset");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (verification) {
      void confirmEmail(verification).then(async () => {
        const next = await getCurrentUser(); setUser(next);
        editor().toast(next ? "Email verified — your cloud account is ready" : "Email verified — sign in to continue", "success");
      }).catch((err) => editor().toast((err as Error).message, "error"));
    } else void getCurrentUser().then(setUser).catch(() => setUser(null));
    if (reset) queueMicrotask(() => { setResetToken(reset); setOpen(true); });
  }, []);

  const signOut = async () => {
    await logoutAccount(); setUser(null); setManage(false);
    editor().toast("Signed out — local autosave stays available", "info");
  };

  return <>
    {user ? <div className="account-chip">
      <button className="account-name" title="Account settings" onClick={() => setManage(true)}>
        {user.verified ? <ShieldCheck size={14} /> : <UserRound size={14} />}<span>{user.name}</span>
      </button>
      <button className="tb-icon" title="Sign out" onClick={() => void signOut()}><LogOut size={13} /></button>
    </div> : <button className="tb-btn" onClick={() => setOpen(true)}><LogIn size={14} /> Sign in</button>}
    {open && <AuthModal initialMode={resetToken ? "reset" : "login"} resetToken={resetToken} onClose={() => { setOpen(false); setResetToken(""); }} onUser={(next) => {
      setUser(next); setOpen(false); setResetToken("");
      editor().toast(next.verified ? "Signed in — secure cloud save is active" : "Account created — check your email to activate cloud features", "success");
    }} />}
    {manage && user && <ManageAccount user={user} onClose={() => setManage(false)} onSignedOut={() => { setUser(null); setManage(false); }} />}
  </>;
}

function AuthModal({ initialMode, resetToken, onClose, onUser }: { initialMode: AuthMode; resetToken: string; onClose: () => void; onUser: (user: AccountUser) => void }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const title = mode === "login" ? "Sign in" : mode === "register" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Choose a new password";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "login") onUser(await loginAccount(email, password));
      else if (mode === "register") onUser(await registerAccount(name, email, password));
      else if (mode === "forgot") { await requestPasswordReset(email); setMessage("If that account exists, a secure reset link has been sent."); }
      else {
        if (password !== confirm) throw new Error("Passwords do not match");
        await confirmPasswordReset(resetToken, password);
        setMessage("Password updated. You can now sign in."); setPassword(""); setConfirm(""); setMode("login");
      }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal auth-modal" role="dialog" aria-label={title}>
      <header><h2>{title}</h2><button className="tb-icon" onClick={onClose} title="Close"><X size={15} /></button></header>
      <form className="modal-body auth-form" onSubmit={submit}>
        {mode === "register" && <label>Display name<input className="txt" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>}
        {mode !== "reset" && <label>Email<input className="txt" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
        {(mode === "login" || mode === "register" || mode === "reset") && <label>{mode === "reset" ? "New password" : "Password"}<input className="txt" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {mode === "reset" && <label>Confirm password<input className="txt" type="password" autoComplete="new-password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>}
        {(mode === "register" || mode === "reset") && <p className="pal-note">Use 10 or more characters with at least one letter and one number.</p>}
        {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
        <button className="btn primary wide" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Update password"}</button>
        {mode === "login" && <button type="button" className="btn wide" onClick={() => { setMode("forgot"); setError(""); }}>Forgot password?</button>}
        {mode !== "reset" && <button type="button" className="btn wide" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); setMessage(""); }}>{mode === "register" ? "I already have an account" : "Create a new account"}</button>}
      </form>
    </div>
  </div>;
}

function ManageAccount({ user, onClose, onSignedOut }: { user: AccountUser; onClose: () => void; onSignedOut: () => void }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [deletePassword, setDeletePassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async (task: () => Promise<void>, success: string) => {
    setBusy(true); setError("");
    try { await task(); editor().toast(success, "success"); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal auth-modal" role="dialog" aria-label="Account settings">
      <header><h2>Account settings</h2><button className="tb-icon" onClick={onClose} title="Close"><X size={15} /></button></header>
      <div className="modal-body auth-form">
        <div className="account-summary"><UserRound size={18} /><div><strong>{user.name}</strong><span>{user.email}</span></div></div>
        {!user.verified ? <button className="btn wide" disabled={busy} onClick={() => void run(resendVerification, "Verification email sent")}><MailCheck size={14} /> Resend verification email</button> : <p className="form-success"><ShieldCheck size={14} /> Email verified</p>}
        <div className="auth-divider" />
        <label>Current password<input className="txt" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label>New password<input className="txt" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <button className="btn wide" disabled={busy || !current || !next} onClick={() => void run(async () => { await changePassword(current, next); onSignedOut(); }, "Password changed — sign in again")}><KeyRound size={14} /> Change password</button>
        <div className="auth-divider" />
        <label>Confirm password to delete account<input className="txt" type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} /></label>
        <button className="btn danger wide" disabled={busy || !deletePassword} onClick={() => { if (window.confirm("Delete your account and all cloud projects permanently?")) void run(async () => { await deleteAccount(deletePassword); onSignedOut(); }, "Account deleted"); }}><Trash2 size={14} /> Delete account</button>
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  </div>;
}
