"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? "");
      setChecking(false);
    });
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (checking) return <p className="p-6">Loading...</p>;

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">Receipt Scanner</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden opacity-60 sm:inline">{email}</span>
          <button onClick={logout} className="rounded border px-3 py-1">
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl p-4">{children}</main>
    </div>
  );
}