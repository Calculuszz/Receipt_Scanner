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

/** The category-tile mosaic used as the app's picture. */
function TileHero({ large }: { large?: boolean }) {
  const tile = large ? "text-[15px]" : "text-[13px]";
  return (
    <div aria-hidden="true"
      className={`grid grid-cols-[1.25fr_1fr] gap-2 text-ink ${large ? "h-[360px] grid-rows-[1fr_1fr_64px] gap-3" : "h-[184px] grid-rows-[1fr_1fr_44px]"}`}>
      <span className={`anim-rise relative row-span-2 flex flex-col justify-end bg-[#22D27F] ${large ? "rounded-[34px] p-6" : "rounded-[26px] p-4"}`}>
        <Icon d={ICONS.food} size={large ? 28 : 22} className={`absolute opacity-60 ${large ? "right-6 top-6" : "right-4 top-4"}`} />
        <span className={`${tile} font-medium`}>Food &amp; Drinks</span>
      </span>
      <span className={`anim-rise relative flex flex-col justify-end bg-[#0EB6F2] [animation-delay:70ms] ${large ? "rounded-[28px] p-5" : "rounded-[22px] px-3.5 py-3"}`}>
        <Icon d={ICONS.transport} size={large ? 22 : 18} className={`absolute opacity-60 ${large ? "right-5 top-5" : "right-3 top-3"}`} />
        <span className={`${tile} font-medium`}>Transport</span>
      </span>
      <span className={`anim-rise relative flex flex-col justify-end bg-[#FFB34F] [animation-delay:140ms] ${large ? "rounded-[28px] p-5" : "rounded-[22px] px-3.5 py-3"}`}>
        <Icon d={ICONS.printing} size={large ? 22 : 18} className={`absolute opacity-60 ${large ? "right-5 top-5" : "right-3 top-3"}`} />
        <span className={`${tile} font-medium`}>Printing</span>
      </span>
      <span className={`anim-rise col-span-2 flex items-center justify-between bg-[#C38BFA] [animation-delay:210ms] ${large ? "rounded-[24px] px-6" : "rounded-[18px] px-4"}`}>
        <span className={`${tile} font-medium`}>Equipment</span>
        <Icon d={ICONS.equipment} size={large ? 22 : 18} className="opacity-60" />
      </span>
    </div>
  );
}

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [toast, setToast] = useState("");

  // Already logged in? Skip this page. Came back from a failed Google sign-in? Say so.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "google") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("Google sign-in didn't finish. Try again, or use your email.");
      window.history.replaceState(null, "", window.location.pathname);
    }
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

  async function google() {
    if (googleLoading) return;
    setGoogleLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser leaves for Google, so we only get here on an error.
    if (error) {
      setGoogleLoading(false);
      setError("Couldn't open Google sign-in. Try again, or use your email.");
    }
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
      <main className="anim-fade mx-auto flex min-h-screen w-full max-w-md flex-col items-center px-6 pb-9 pt-24 text-center md:justify-center md:pt-9">
        {toastEl}
        <span className="anim-rise flex h-24 w-24 items-center justify-center rounded-[30px] bg-[#0EB6F2] text-ink">
          <Icon d={ICONS.mail} size={44} stroke={1.6} />
        </span>
        <h1 className="mt-8 text-[30px] font-semibold tracking-[-0.035em]">Check your email</h1>
        <p className="mt-2.5 max-w-[300px] text-base leading-relaxed text-muted">
          We sent a link to <span className="font-medium text-fg">{sentTo}</span>. Tap it to finish creating your account.
        </p>
        <div className="min-h-8 flex-1 md:hidden" />
        <Link href="/login" onClick={() => setSentTo("")}
          className="tap flex h-14 w-full items-center justify-center rounded-[18px] bg-fg text-[17px] font-semibold text-bg md:mt-10">
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
    <main className="min-h-screen md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {toastEl}

      {/* Tablet / desktop: brand panel on the left */}
      <aside className="hidden flex-col justify-between bg-surface p-10 md:flex lg:p-16">
        <p className="text-[15px] font-semibold">Receipt Scanner</p>
        <div className="mx-auto w-full max-w-[460px]">
          <TileHero large />
          <h2 className="mt-10 text-[40px] font-semibold leading-[1.1] tracking-[-0.04em]">Snap a receipt.<br />We do the typing.</h2>
          <p className="mt-4 max-w-[400px] text-[17px] leading-relaxed text-muted">
            Gemini reads the shop, date and total from Thai or English receipts, and your club&apos;s spending adds itself up.
          </p>
        </div>
        <p className="text-[13px] text-muted">Lumina Club · CEE Final Project 2026</p>
      </aside>

      <section className="flex min-h-screen flex-col md:items-center md:justify-center md:px-10">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:flex-none">
          {mode === "signup" && (
            <div className="px-4 pt-[max(20px,env(safe-area-inset-top))] md:px-6">
              <RoundButton icon={ICONS.back} aria-label="Back to log in" onClick={() => router.push("/login")} />
            </div>
          )}
          <form onSubmit={handleSubmit} noValidate
            className={`anim-fade flex flex-1 flex-col px-6 pb-9 ${mode === "login" ? "pt-[max(40px,env(safe-area-inset-top))] md:pt-0" : "pt-6"}`}>
            {mode === "login" && <div className="md:hidden"><TileHero /></div>}
            <h1 className={`${mode === "login" ? "mt-9 text-[34px] md:mt-0" : "text-[30px]"} font-semibold tracking-[-0.035em]`}>
              {mode === "login" ? (<><span className="md:hidden">Receipt Scanner</span><span className="hidden md:inline">Welcome back</span></>) : "Create your account"}
            </h1>
            <p className="mt-2 text-base leading-relaxed text-muted">
              {mode === "login"
                ? (<><span className="md:hidden">Snap a receipt. We read the shop, date and total for you.</span><span className="hidden md:inline">Log in to see and scan your receipts.</span></>)
                : "Use your university email so the club can find your receipts."}
            </p>

            <div className="field-card mt-8 rounded-[20px] bg-surface px-4 transition-shadow md:bg-surface2/50 md:dark:bg-surface">
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
            <button type="button" onClick={google} disabled={googleLoading}
              className="tap flex h-14 items-center justify-center gap-3 rounded-[18px] bg-surface text-base font-medium md:border md:border-line">
              {googleLoading ? <Spinner /> : (
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
              )}
              {googleLoading ? "Opening Google…" : "Continue with Google"}
            </button>

            <div className="min-h-6 flex-1 md:hidden" />
            <p className="text-center text-[15px] text-muted md:mt-8">
              {mode === "login" ? "New here?" : "Already have an account?"}{" "}
              <Link href={mode === "login" ? "/signup" : "/login"} className="tap inline-flex h-11 items-center px-1 font-semibold text-fg">
                {mode === "login" ? "Create an account" : "Log in"}
              </Link>
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
