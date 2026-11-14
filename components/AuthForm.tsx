"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (!data.session) {
      setError("Please confirm your email first, then log in.");
      return;
    }
    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">
        {mode === "login" ? "Log in" : "Sign up"}
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border px-3 py-2"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          disabled={loading}
          className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
        >
          {loading ? "Please wait..." : mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      <p className="text-sm">
        {mode === "login" ? (
          <>No account? <Link href="/signup" className="underline">Sign up</Link></>
        ) : (
          <>Have an account? <Link href="/login" className="underline">Log in</Link></>
        )}
      </p>
    </main>
  );
}