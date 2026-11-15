"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function TemporaryLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: String(values.get("email") ?? "").trim(),
        password: String(values.get("password") ?? ""),
      });
      if (authError) throw new Error(authError.message);
      if (!data.session) throw new Error("Please confirm your email before logging in.");
      form.reset();
      router.replace("/scan");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Temporary test login</h1>
        <p className="mt-2">Sign in with your test account to open the receipt scanner.</p>
      </header>
      <form onSubmit={login} className="space-y-4" aria-busy={loading}>
        <fieldset disabled={loading} className="space-y-4">
          <label className="block">Email
            <input name="email" type="email" autoComplete="username" required className="mt-1 block w-full rounded border border-gray-400 p-2" />
          </label>
          <label className="block">Password
            <input name="password" type="password" autoComplete="current-password" required className="mt-1 block w-full rounded border border-gray-400 p-2" />
          </label>
          <button type="submit" className="flex items-center gap-2 rounded border border-gray-400 px-4 py-2 disabled:opacity-50" disabled={loading}>
            {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent motion-reduce:animate-none" />}
            {loading ? "Logging in…" : "Log in and open scanner"}
          </button>
        </fieldset>
        {loading && <p role="status">Signing in…</p>}
        {error && <p role="alert" className="text-red-600">{error}</p>}
      </form>
      <Link href="/scan" className="inline-block underline">Already signed in? Open scanner</Link>
    </main>
  );
}
