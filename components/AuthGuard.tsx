"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { Spinner } from "@/components/ui";

/** Shows children only to a logged-in user; otherwise goes to /login. Each page draws its own top bar. */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setChecking(false);
    });
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted" role="status">
        <Spinner size={28} />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  return <div className="mx-auto min-h-screen w-full max-w-md">{children}</div>;
}
