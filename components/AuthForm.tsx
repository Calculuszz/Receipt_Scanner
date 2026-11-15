"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";
import { ICONS } from "@/lib/ui";
import { Icon, RoundButton, Spinner, Toast } from "@/components/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Supabase error text → words a club member understands.
function friendly(message: string, mode: "login" | "signup") {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match. Try again or reset your password.";
  if (m.includes("email not confirmed")) return "Confirm your email first. Check your inbox for the link we sent.";
  if (m.includes("already registered")) return "There's already an account with this email. Log in instead.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many tries. Wait a minute, then try again.";
  if (m.includes("password")) return "Your password needs at least 6 characters.";
  if (m.includes("fetch") || m.includes("network")) return "Can't reach the server. Check your internet and try again.";
  return mode === "login" ? "Couldn't log you in. Please try again." : "Couldn't create your account. Please try again.";
}

function Field({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <label className={`flex min-h-[54px] items-center gap-3 ${last ? "" : "border-b border-line"}`}>
      <span className="w-[78px] shrink-0 text-[15px]">{label}</span>
      {children}
    </label>
  );
}

const input = "min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-muted outline-none";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [toast, setToast] = useState("");

  // Already logged in? Skip this page.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  const pwOk = password.length >= 6;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    const cleanEmail = email.trim();
    if (mode === "signup" && !name.trim()) return setError("Add your name so the club knows who paid.");
    if (!EMAIL_RE.test(cleanEmail)) return setError(mode === "login" ? "Enter the email you signed up with." : "That email doesn't look right. Check for typos.");
    if (mode === "login" && !password) return setError("Enter your password.");
    if (mode === "signup" && !pwOk) return setError("Your password needs at least 6 characters.");

    setLoading(true);
    setError("");
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      setLoading(false);
      if (error) return setError(friendly(error.message, mode));
      router.replace("/");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { name: name.trim() }, emailRedirectTo: `${window.location.origin}/` },
    });
    setLoading(false);
    if (error) return setError(friendly(error.message, mode));
    if (data.session) {
      router.replace("/");
      return;
    }
    setPassword("");
    setSentTo(cleanEmail);
  }

  async function forgot() {
    const cleanEmail = email.trim();
    if (!EMAIL_RE.test(cleanEmail)) return setError("Type your email first, then tap Forgot password.");
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return setError(friendly(error.message, mode));
    setToast(`Reset link sent to ${cleanEmail}`);
  }

  async function resend() {
    const { error } = await supabase.auth.resend({ type: "signup", email: sentTo });
    setToast(error ? "Couldn't send it again. Wait a minute and retry." : "Link sent again");
  }

  const toastEl = toast && <Toast text={toast} onDone={() => setToast("")} />;

  // ---------- After sign-up: check your email ----------
  if (sentTo) {
    return (
      <main className="anim-fade mx-auto flex min-h-screen w-full max-w-md flex-col items-center px-6 pb-9 pt-24 text-center">
        {toastEl}
        <span className="anim-rise flex h-24 w-24 items-center justify-center rounded-[30px] bg-[#0EB6F2] text-ink">
          <Icon d={ICONS.mail} size={44} stroke={1.6} />
        </span>
        <h1 className="mt-8 text-[30px] font-semibold tracking-[-0.035em]">Check your email</h1>
        <p className="mt-2.5 max-w-[300px] text-base leading-relaxed text-muted">
          We sent a link to <span className="font-medium text-fg">{sentTo}</span>. Tap it to finish creating your account.
        </p>
        <div className="min-h-8 flex-1" />
        <Link href="/login" onClick={() => setSentTo("")}
          className="tap flex h-14 w-full items-center justify-center rounded-[18px] bg-fg text-[17px] font-semibold text-bg">
          Back to log in
        </Link>
        <button type="button" onClick={resend} className="tap mt-2 h-12 px-3 text-[15px] font-medium text-muted">
          Didn&apos;t get it? Send again
        </button>
      </main>
    );
  }

  const pwField = (
    <Field label="Password" last>
      <input
        type={showPw ? "text" : "password"}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        value={password}
        onChange={(e) => { setPassword(e.target.value); setError(""); }}
        placeholder={mode === "login" ? "Your password" : "Make one up"}
        className={input}
      />
      <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
        className="tap -mr-2.5 flex h-11 w-11 items-center justify-center text-muted">
        <Icon d={showPw ? ICONS.eyeOff : ICONS.eye} />
      </button>
    </Field>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col">
      {toastEl}
      {mode === "signup" && (
        <div className="px-4 pt-[max(20px,env(safe-area-inset-top))]">
          <RoundButton icon={ICONS.back} aria-label="Back to log in" onClick={() => router.push("/login")} />
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate
        className={`anim-fade flex flex-1 flex-col px-6 pb-9 ${mode === "login" ? "pt-[max(40px,env(safe-area-inset-top))]" : "pt-6"}`}>
        {mode === "login" && (
          <div aria-hidden="true" className="grid h-[184px] grid-cols-[1.25fr_1fr] grid-rows-[1fr_1fr_44px] gap-2 text-ink">
            <span className="anim-rise relative row-span-2 flex flex-col justify-end rounded-[26px] bg-[#22D27F] p-4">
              <Icon d={ICONS.food} size={22} className="absolute right-4 top-4 opacity-60" />
              <span className="text-[13px] font-medium">Food &amp; Drinks</span>
            </span>
            <span className="anim-rise relative flex flex-col justify-end rounded-[22px] bg-[#0EB6F2] px-3.5 py-3 [animation-delay:70ms]">
              <Icon d={ICONS.transport} size={18} className="absolute right-3 top-3 opacity-60" />
              <span className="text-[13px] font-medium">Transport</span>
            </span>
            <span className="anim-rise relative flex flex-col justify-end rounded-[22px] bg-[#FFB34F] px-3.5 py-3 [animation-delay:140ms]">
              <Icon d={ICONS.printing} size={18} className="absolute right-3 top-3 opacity-60" />
              <span className="text-[13px] font-medium">Printing</span>
            </span>
            <span className="anim-rise col-span-2 flex items-center justify-between rounded-[18px] bg-[#C38BFA] px-4 [animation-delay:210ms]">
              <span className="text-[13px] font-medium">Equipment</span>
              <Icon d={ICONS.equipment} size={18} className="opacity-60" />
            </span>
          </div>
        )}
        <h1 className={`${mode === "login" ? "mt-9 text-[34px]" : "text-[30px]"} font-semibold tracking-[-0.035em]`}>
          {mode === "login" ? "Receipt Scanner" : "Create your account"}
        </h1>
        <p className="mt-2 text-base leading-relaxed text-muted">
          {mode === "login"
            ? "Snap a receipt. We read the shop, date and total for you."
            : "Use your university email so the club can find your receipts."}
        </p>

        <div className="field-card mt-8 rounded-[20px] bg-surface px-4 transition-shadow">
          {mode === "signup" && (
            <Field label="Name">
              <input autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setError(""); }}
                placeholder="Pim Srisuk" className={input} />
            </Field>
          )}
          <Field label="Email">
            <input type="email" inputMode="email" autoComplete="email" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="you@student.chula.ac.th" className={input} />
          </Field>
          {pwField}
        </div>

        {mode === "signup" && (
          <p className={`mx-1 mt-3 flex items-center gap-2 text-sm transition-colors ${pwOk ? "text-fg" : "text-muted"}`}>
            <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-ink transition-colors ${pwOk ? "bg-brand" : "bg-surface2"}`}>
              <Icon d={ICONS.check} size={11} stroke={3.2} />
            </span>
            At least 6 characters
          </p>
        )}

        {error && <p role="alert" className="anim-rise mx-1 mt-3 text-sm leading-snug text-danger">{error}</p>}

        {mode === "login" && (
          <button type="button" onClick={forgot} className="tap mt-1.5 h-11 self-end px-1 text-sm font-medium text-muted">
            Forgot password?
          </button>
        )}

        <button type="submit" disabled={loading}
          className={`tap flex h-14 items-center justify-center gap-2.5 rounded-[18px] bg-fg text-[17px] font-semibold text-bg disabled:opacity-80 ${mode === "login" ? "mt-2.5" : "mt-6"}`}>
          {loading && <Spinner />}
          {mode === "login" ? (loading ? "Logging in…" : "Log in") : (loading ? "Creating account…" : "Create account")}
        </button>

        <div aria-hidden="true" className="my-5 flex items-center gap-3 text-[13px] text-muted">
          <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
        </div>
        <button type="button" disabled aria-describedby="google-note"
          className="flex h-14 items-center justify-center rounded-[18px] bg-surface text-base font-medium text-muted">
          Continue with Google
        </button>
        <p id="google-note" className="mt-2 text-center text-[13px] text-muted">
          Google sign-in isn&apos;t available yet. Use your email for now.
        </p>

        <div className="min-h-6 flex-1" />
        <p className="text-center text-[15px] text-muted">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <Link href={mode === "login" ? "/signup" : "/login"} className="tap inline-flex h-11 items-center px-1 font-semibold text-fg">
            {mode === "login" ? "Create an account" : "Log in"}
          </Link>
        </p>
      </form>
    </main>
  );
}
