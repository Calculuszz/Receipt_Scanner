"use client";
// Reset password: opened from the email link sent by "Forgot password?".
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";
import { ICONS } from "@/lib/ui";
import { Icon, Spinner } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // The email link signs the user in for this one step.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setReady(!!session));
    supabase.auth.getSession().then(({ data: s }) => setReady(!!s.session));
    return () => data.subscription.unsubscribe();
  }, []);

  const pwOk = password.length >= 6;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!pwOk) return setError("Your new password needs at least 6 characters.");
    setSaving(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return setError("Couldn't save the new password. Open the link from your email again.");
    router.replace("/");
  }

  if (ready === null) {
    return <div className="flex min-h-screen items-center justify-center text-muted"><Spinner size={28} /></div>;
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">This link has expired</h1>
        <p className="mt-2 text-muted">Go back to log in and tap Forgot password to get a new one.</p>
        <Link href="/login" className="tap mt-8 flex h-14 items-center justify-center rounded-[18px] bg-fg text-[17px] font-semibold text-bg">
          Back to log in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pt-24">
      <form onSubmit={save} noValidate className="anim-fade flex flex-col">
        <h1 className="text-[30px] font-semibold tracking-[-0.035em]">Set a new password</h1>
        <p className="mt-2 text-muted">You&apos;ll use it the next time you log in.</p>
        <label className="field-card mt-8 flex min-h-[54px] items-center gap-3 rounded-[20px] bg-surface px-4 transition-shadow">
          <span className="w-[78px] shrink-0 text-[15px]">Password</span>
          <input type={showPw ? "text" : "password"} autoComplete="new-password" value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="New password" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
            className="tap -mr-2.5 flex h-11 w-11 items-center justify-center text-muted">
            <Icon d={showPw ? ICONS.eyeOff : ICONS.eye} />
          </button>
        </label>
        {error && <p role="alert" className="anim-rise mx-1 mt-3 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={saving}
          className="tap mt-6 flex h-14 items-center justify-center gap-2.5 rounded-[18px] bg-fg text-[17px] font-semibold text-bg">
          {saving && <Spinner />}
          {saving ? "Saving…" : "Save password"}
        </button>
      </form>
    </main>
  );
}
