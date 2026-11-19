"use client";
// Admins see everyone who signed up and can make them admin or remove it.
// The rules (admins only, never zero admins) live in the set_admin() database function.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { memberName } from "@/lib/admin";
import { ICONS } from "@/lib/ui";
import { Icon, Spinner, Toast } from "@/components/ui";
import { useShell } from "@/components/AppShell";

type Member = { id: string; display_name: string | null; email: string | null; is_admin: boolean; joined_at: string; receipts: number };

export default function MemberList() {
  const { me, refreshCounts } = useShell();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<{ m: Member; make: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("club_members");
    if (error) { setError(error.message || "We couldn't load the members."); return; }
    setError("");
    setMembers((data ?? []) as Member[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members ?? []).filter((m) => !q || `${m.display_name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q));
  }, [members, query]);
  const admins = members?.filter((m) => m.is_admin).length ?? 0;

  async function apply() {
    if (!confirm || saving) return;
    setSaving(true);
    const { m, make } = confirm;
    const { error } = await supabase.rpc("set_admin", { target: m.id, make_admin: make });
    setSaving(false);
    setConfirm(null);
    if (error) { setToast(error.message); return; }
    setToast(make ? `${memberName(m)} is now an admin` : `${memberName(m)} is no longer an admin`);
    await load();
    // Removing yourself takes the admin tabs away right away.
    if (m.id === me.id) refreshCounts();
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-16 pt-5 md:max-w-2xl md:px-10">
      {toast && <Toast text={toast} onDone={() => setToast("")} />}

      <label className="field-card flex h-12 items-center gap-2.5 rounded-2xl bg-surface px-4">
        <Icon d={ICONS.search} size={18} className="text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" aria-label="Search members"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
      </label>
      <p className="mx-1 mt-3 text-[13px] text-muted">
        Admins check receipts, pay members back, see the whole club and add other admins.
        {members && ` ${admins} admin${admins === 1 ? "" : "s"} · ${members.length} members.`}
      </p>

      <div className="mt-3">
        {members === null && !error ? (
          <div className="flex justify-center py-24 text-muted" role="status"><Spinner size={28} /><span className="sr-only">Loading</span></div>
        ) : error ? (
          <p className="rounded-[20px] bg-surface p-5 text-[15px]">{error}</p>
        ) : shown.length === 0 ? (
          <p className="rounded-[20px] bg-surface p-5 text-center text-[15px] text-muted">No one matches “{query}”.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((m, i) => {
              const you = m.id === me.id;
              const last = m.is_admin && admins <= 1;
              return (
                <li key={m.id} className="anim-rise flex items-center gap-3 rounded-[20px] bg-surface p-3" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold ${m.is_admin ? "bg-fg text-bg" : "bg-surface2"}`}>
                    {memberName(m).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium">{memberName(m)}{you && <span className="text-muted"> (you)</span>}</span>
                      {m.is_admin && (
                        <span className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-ink">
                          <Icon d={ICONS.shield} size={11} stroke={2.2} />Admin
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[13px] text-muted">{m.email} · {m.receipts} receipt{m.receipts === 1 ? "" : "s"}</span>
                  </span>
                  {m.is_admin ? (
                    <button type="button" disabled={last} onClick={() => setConfirm({ m, make: false })}
                      title={last ? "The club needs at least one admin" : undefined}
                      className="tap h-9 shrink-0 rounded-full bg-surface2 px-3.5 text-[13px] font-medium text-danger disabled:text-muted disabled:opacity-60">
                      {last ? "Only admin" : "Remove admin"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirm({ m, make: true })}
                      className="tap h-9 shrink-0 rounded-full bg-fg px-3.5 text-[13px] font-semibold text-bg">Make admin</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby="role-title">
          <div className="anim-dim absolute inset-0 bg-black/40" onClick={() => !saving && setConfirm(null)} />
          <div className="anim-sheet relative w-full max-w-md rounded-t-[28px] bg-bg p-5 pb-[max(20px,env(safe-area-inset-bottom))] md:rounded-[28px]">
            <p id="role-title" className="text-lg font-semibold">
              {confirm.make ? `Make ${memberName(confirm.m)} an admin?` : confirm.m.id === me.id ? "Remove yourself as admin?" : `Remove ${memberName(confirm.m)} as admin?`}
            </p>
            <p className="mt-1 text-[15px] text-muted">
              {confirm.make
                ? "They'll be able to see every member's receipts, approve or send them back, mark them paid and add other admins."
                : confirm.m.id === me.id
                  ? "You'll lose the Review, Club, Reports and Members pages. Another admin can add you back."
                  : "They'll go back to only sending their own receipts."}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setConfirm(null)} disabled={saving} className="tap h-12 rounded-2xl bg-surface text-[15px] font-medium">Cancel</button>
              <button type="button" onClick={() => void apply()} disabled={saving}
                className={`tap flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold ${confirm.make ? "bg-brand text-ink" : "bg-danger text-white"}`}>
                {saving && <Spinner />}{confirm.make ? "Make admin" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
