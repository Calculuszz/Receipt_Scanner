"use client";
// What someone sees after signing up, until a club admin lets them in.
import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { ICONS } from "@/lib/ui";
import { Icon, Spinner } from "@/components/ui";
import { useShell } from "@/components/AppShell";

export default function JoinGate() {
  const { me, refreshCounts } = useShell();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const declined = me.status === "rejected";

  async function check() {
    setBusy(true); setMessage("");
    await refreshCounts(); // re-runs claim_membership: lets you in if an admin added your email meanwhile
    setBusy(false);
    setMessage("Still waiting. You'll get a notification here as soon as an admin lets you in.");
  }

  async function askAgain() {
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("request_membership");
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    await refreshCounts();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 pb-16 pt-14 text-center">
      <span className="anim-pop flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: declined ? "color-mix(in srgb, var(--danger) 14%, transparent)" : "var(--warn-bg)", color: declined ? "var(--danger)" : "var(--warn-text)" }}>
        <Icon d={declined ? ICONS.warn : ICONS.users} size={28} stroke={1.9} />
      </span>
      <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
        {declined ? "Your request wasn't accepted" : "Waiting for a club admin"}
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {declined
          ? "A club admin declined your request to join. If you're a club head, message the treasurer, or ask again later."
          : "This app is for club heads. A club admin needs to let you in before you can scan and send receipts."}
      </p>
      <div className="mt-6 w-full rounded-[20px] bg-surface p-4 text-left text-[14px] leading-relaxed">
        <p className="font-medium">Faster way in</p>
        <p className="mt-1 text-muted">
          Ask the treasurer to add the email you signed in with to the club&apos;s list. You&apos;ll be let in right away.
        </p>
      </div>
      <div className="mt-5 flex w-full flex-col gap-2.5">
        {declined ? (
          <button type="button" disabled={busy} onClick={() => void askAgain()}
            className="tap flex h-12 items-center justify-center gap-2 rounded-2xl bg-fg text-[15px] font-semibold text-bg">
            {busy && <Spinner />} Ask to join again
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void check()}
            className="tap flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface text-[15px] font-medium">
            {busy && <Spinner />} Check again
          </button>
        )}
      </div>
      {message && <p role="status" className="anim-pop mt-3 text-[13px] text-muted">{message}</p>}
    </div>
  );
}
