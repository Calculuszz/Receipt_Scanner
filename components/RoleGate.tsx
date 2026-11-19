"use client";
import Link from "next/link";
import { useShell } from "@/components/AppShell";

/** Shows a page only to the treasurer ("admin") or to anyone with a club role ("club"). RLS still guards the data. */
export default function RoleGate({ need, children }: { need: "admin" | "club"; children: React.ReactNode }) {
  const { me } = useShell();
  const ok = need === "admin" ? me.admin : me.seesClub;
  if (ok) return <>{children}</>;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <p className="text-xl font-semibold">Only for the club treasurer</p>
      <p className="text-[15px] text-muted">Ask the treasurer if you think you should see this page.</p>
      <Link href="/" className="tap mt-3 flex h-12 items-center rounded-full bg-surface px-5 text-[15px] font-medium">Back to my receipts</Link>
    </div>
  );
}
