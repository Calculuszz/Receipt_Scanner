"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { Spinner } from "@/components/ui";

/** Shows children only to a logged-in user; otherwise goes to /login. Each page draws its own top bar. */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { bfcacheId } = router;
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

  // Cache Components keeps a page you leave alive (React Activity), so coming back
  // to /scan used to show the old "Saving…" state. Keying on bfcacheId gives every
  // fresh visit (Link, push, replace) a clean page; browser Back still restores it.
  return <div key={bfcacheId} className="mx-auto min-h-screen w-full max-w-md">{children}</div>;
}
