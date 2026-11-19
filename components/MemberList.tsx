"use client";
// Club admins manage who is in the club:
//   Members   - active members; make or remove admins; remove from the club
//   Requests  - people who signed up with an email that isn't on the list; let in or decline
//   Allowed   - emails from the club's contact list; those people get in as soon as they sign in
//   Removed   - past members; bring them back
// Every rule (admins only, never zero admins, verified emails only) lives in the database functions.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { memberName, type MemberStatus } from "@/lib/admin";
import { ICONS } from "@/lib/ui";
import { Icon, Spinner, Toast } from "@/components/ui";
import { useShell } from "@/components/AppShell";

type Member = {
  id: string; display_name: string | null; email: string | null; is_admin: boolean; status: MemberStatus;
  requested_at: string | null; decided_at: string | null; joined_at: string; receipts: number;
};
type Allowed = { email: string; added_at: string };
type Tab = "members" | "requests" | "allowed" | "removed";
type Action =
  | { kind: "admin"; m: Member; make: boolean }
  | { kind: "status"; m: Member; to: "active" | "rejected" | "removed" };

function when(ts: string | null) {
  if (!ts) return "";
  const d = (Date.now() - new Date(ts).getTime()) / 864e5;
  return d < 1 ? "today" : d < 2 ? "yesterday" : new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function MemberList() {
  const { me, refreshCounts, bump } = useShell();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [allowed, setAllowed] = useState<Allowed[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const [m, a] = await Promise.all([
      supabase.rpc("club_members"),
      supabase.from("club_allowlist").select("email, added_at").order("added_at", { ascending: false }),
    ]);
    if (m.error) { setError(m.error.message || "We couldn't load the members."); return; }
    setError("");
    setMembers((m.data ?? []) as Member[]);
    setAllowed((a.data ?? []) as Allowed[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, bump]);

  const lists = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = (members ?? []).filter((m) => !q || `${m.display_name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q));
    return {
      members: all.filter((m) => m.status === "active"),
      requests: all.filter((m) => m.status === "pending" || m.status === "rejected")
        .sort((a, b) => (a.status === b.status ? 0 : a.status === "pending" ? -1 : 1)),
      removed: all.filter((m) => m.status === "removed"),
    };
  }, [members, query]);
  const admins = members?.filter((m) => m.is_admin && m.status === "active").length ?? 0;
  const waiting = members?.filter((m) => m.status === "pending").length ?? 0;
  const onList = useMemo(() => new Set(allowed.map((a) => a.email)), [allowed]);

  async function apply() {
    if (!action || saving) return;
    setSaving(true);
    const { error } = action.kind === "admin"
      ? await supabase.rpc("set_admin", { target: action.m.id, make_admin: action.make })
      : await supabase.rpc("set_membership", { target: action.m.id, new_status: action.to });
    setSaving(false);
    const a = action;
    setAction(null);
    if (error) { setToast(error.message); return; }
    const name = memberName(a.m);
    setToast(a.kind === "admin"
      ? (a.make ? `${name} is now an admin` : `${name} is no longer an admin`)
      : a.to === "active" ? `${name} is in the club` : a.to === "rejected" ? `Declined ${name}` : `${name} was removed`);
    await load();
    await refreshCounts(); // badges, and your own tabs if you changed yourself
  }

  async function addEmails() {
    // Accept anything pasted from a sheet: commas, spaces, new lines, "Name <email>".
    const emails = [...new Set((paste.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g) ?? []).map((e) => e.toLowerCase()))];
    if (!emails.length) { setToast("No email addresses found in what you pasted."); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("add_allowed_emails", { emails });
    setSaving(false);
    if (error) { setToast(error.message); return; }
    const r = (data ?? {}) as { added?: number; activated?: number };
    setPaste("");
    setToast(`Added ${r.added ?? 0} email${r.added === 1 ? "" : "s"}` + (r.activated ? ` · let in ${r.activated} waiting` : ""));
    await load();
    await refreshCounts();
  }

  async function removeEmail(email: string) {
    const { error } = await supabase.rpc("remove_allowed_email", { target: email });
    if (error) { setToast(error.message); return; }
    setAllowed((list) => list.filter((a) => a.email !== email));
  }

  const TABS: { v: Tab; label: string; count?: number }[] = [
    { v: "members", label: "Members" },
    { v: "requests", label: "Requests", count: waiting },
    { v: "allowed", label: "Allowed emails" },
    { v: "removed", label: "Removed" },
  ];

  function row(m: Member, i: number) {
    const you = m.id === me.id;
    const lastAdmin = m.is_admin && admins <= 1;
    const listed = !!m.email && onList.has(m.email.toLowerCase());
    return (
      <li key={m.id} className="anim-rise rounded-[20px] bg-surface p-3" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
        <div className="flex items-center gap-3">
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
              {m.status === "rejected" && <span className="h-5 shrink-0 rounded-full bg-surface2 px-1.5 text-[11px] font-medium leading-5 text-danger">Declined</span>}
            </span>
            <span className="block truncate text-[13px] text-muted">
              {m.email}
              {m.status === "active" && ` · ${m.receipts} receipt${m.receipts === 1 ? "" : "s"}`}
              {m.status === "pending" && ` · asked ${when(m.requested_at)}`}
              {m.status === "removed" && ` · removed ${when(m.decided_at)}`}
            </span>
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          {m.status === "active" && (
            <>
              {m.is_admin ? (
                <button type="button" disabled={lastAdmin} onClick={() => setAction({ kind: "admin", m, make: false })}
                  title={lastAdmin ? "The club needs at least one admin" : undefined}
                  className="tap h-9 rounded-full bg-surface2 px-3.5 text-[13px] font-medium disabled:opacity-50">
                  {lastAdmin ? "Only admin" : "Remove admin"}
                </button>
              ) : (
                <button type="button" onClick={() => setAction({ kind: "admin", m, make: true })}
                  className="tap h-9 rounded-full bg-surface2 px-3.5 text-[13px] font-medium">Make admin</button>
              )}
              <button type="button" disabled={lastAdmin} onClick={() => setAction({ kind: "status", m, to: "removed" })}
                className="tap h-9 rounded-full bg-surface2 px-3.5 text-[13px] font-medium text-danger disabled:opacity-50">Remove from club</button>
            </>
          )}
          {(m.status === "pending" || m.status === "rejected") && (
            <>
              {m.status === "pending" && (
                <button type="button" onClick={() => setAction({ kind: "status", m, to: "rejected" })}
                  className="tap h-9 rounded-full bg-surface2 px-3.5 text-[13px] font-medium">Decline</button>
              )}
              <button type="button" onClick={() => setAction({ kind: "status", m, to: "active" })}
                className="tap flex h-9 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[13px] font-semibold text-ink">
                <Icon d={ICONS.check} size={14} stroke={2.4} /> Let in
              </button>
            </>
          )}
          {m.status === "removed" && (
            <>
              {listed && <span className="mr-auto self-center text-[12px] text-muted">Still on the allowed list</span>}
              <button type="button" onClick={() => setAction({ kind: "status", m, to: "active" })}
                className="tap h-9 rounded-full bg-surface2 px-3.5 text-[13px] font-medium">Bring back</button>
            </>
          )}
        </div>
      </li>
    );
  }

  const confirmText = (a: Action) => {
    const name = memberName(a.m);
    if (a.kind === "admin") {
      return a.make
        ? { title: `Make ${name} an admin?`, body: "They'll see every member's receipts, approve or send them back, mark them paid, and manage members.", ok: "Make admin", danger: false }
        : { title: a.m.id === me.id ? "Remove yourself as admin?" : `Remove ${name} as admin?`, body: a.m.id === me.id ? "You'll lose the Review, Club, Reports and Members pages." : "They'll go back to only sending their own receipts.", ok: "Remove admin", danger: true };
    }
    if (a.to === "active") return { title: a.m.status === "removed" ? `Bring ${name} back?` : `Let ${name} in?`, body: "They'll be able to scan receipts and send them to the treasurer.", ok: a.m.status === "removed" ? "Bring back" : "Let in", danger: false };
    if (a.to === "rejected") return { title: `Decline ${name}?`, body: "They'll be told, and can ask again after 24 hours.", ok: "Decline", danger: true };
    return {
      title: a.m.id === me.id ? "Leave the club?" : `Remove ${name} from the club?`,
      body: `They can't send new receipts, but keep seeing their past ones. Receipts already sent stay in Review and can still be paid back.${a.m.is_admin ? " This also removes their admin rights." : ""}`,
      ok: "Remove", danger: true,
    };
  };

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-16 pt-5 md:max-w-2xl md:px-10">
      {toast && <Toast text={toast} onDone={() => setToast("")} />}

      <div role="tablist" aria-label="Member lists" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button key={t.v} type="button" role="tab" aria-selected={tab === t.v} onClick={() => setTab(t.v)}
            className={`tap flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${tab === t.v ? "bg-fg text-bg" : "bg-surface text-muted"}`}>
            {t.label}
            {!!t.count && <span className={`rounded-full px-1.5 text-[11px] leading-[18px] ${tab === t.v ? "bg-bg text-fg" : "bg-danger text-white"}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === "allowed" ? (
        <section className="mt-4" aria-label="Allowed emails">
          <p className="mx-1 text-[13px] leading-relaxed text-muted">
            Paste emails from the club&apos;s contact list. Anyone who signs in with one of these (verified) emails gets in right away;
            people already waiting with one are let in now. Removing an email doesn&apos;t remove a member.
          </p>
          <label className="field-card mt-3 block rounded-[20px] bg-surface p-3.5">
            <span className="block text-[13px] text-muted">Emails (one per line, or comma separated)</span>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4}
              placeholder={"head1@student.chula.ac.th\nhead2@gmail.com"}
              className="mt-1 w-full resize-y bg-transparent text-[15px] outline-none placeholder:text-muted" />
          </label>
          <button type="button" disabled={saving || !paste.trim()} onClick={() => void addEmails()}
            className="tap mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-fg text-[15px] font-semibold text-bg disabled:opacity-40">
            {saving && <Spinner />} Add to allowed list
          </button>
          <p className="mx-1 mb-2 mt-5 text-[13px] text-muted">{allowed.length} allowed email{allowed.length === 1 ? "" : "s"}</p>
          {allowed.length > 0 && (
            <ul className="overflow-hidden rounded-[20px] bg-surface">
              {allowed.map((a) => {
                const who = members?.find((m) => m.email?.toLowerCase() === a.email);
                return (
                  <li key={a.email} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{a.email}</span>
                      <span className="text-[12px] text-muted">{who ? (who.status === "active" ? "Signed up · member" : `Signed up · ${who.status}`) : "Hasn't signed up yet"}</span>
                    </span>
                    <button type="button" onClick={() => void removeEmail(a.email)} aria-label={`Remove ${a.email} from the allowed list`}
                      className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted">
                      <Icon d={ICONS.close} size={16} stroke={2} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <>
          <label className="field-card mt-4 flex h-12 items-center gap-2.5 rounded-2xl bg-surface px-4">
            <Icon d={ICONS.search} size={18} className="text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" aria-label="Search members"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          </label>
          {tab === "members" && members && (
            <p className="mx-1 mt-3 text-[13px] text-muted">
              {lists.members.length} member{lists.members.length === 1 ? "" : "s"} · {admins} admin{admins === 1 ? "" : "s"}.
              Admins check receipts, pay members back and manage this list.
            </p>
          )}
          {tab === "requests" && (
            <p className="mx-1 mt-3 text-[13px] text-muted">
              People who signed up with an email that isn&apos;t on the allowed list. You also get a summary of new requests once a day.
            </p>
          )}

          <div className="mt-3">
            {members === null && !error ? (
              <div className="flex justify-center py-24 text-muted" role="status"><Spinner size={28} /><span className="sr-only">Loading</span></div>
            ) : error ? (
              <p className="rounded-[20px] bg-surface p-5 text-[15px]">{error}</p>
            ) : lists[tab].length === 0 ? (
              <p className="rounded-[20px] bg-surface p-5 text-center text-[15px] text-muted">
                {query ? `No one matches “${query}”.` : tab === "requests" ? "No one is waiting to join." : tab === "removed" ? "No removed members." : "No members yet."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">{lists[tab].map(row)}</ul>
            )}
          </div>
        </>
      )}

      {action && (() => {
        const c = confirmText(action);
        return (
          <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby="member-title">
            <div className="anim-dim absolute inset-0 bg-black/40" onClick={() => !saving && setAction(null)} />
            <div className="anim-sheet relative w-full max-w-md rounded-t-[28px] bg-bg p-5 pb-[max(20px,env(safe-area-inset-bottom))] md:rounded-[28px]">
              <p id="member-title" className="text-lg font-semibold">{c.title}</p>
              <p className="mt-1 text-[15px] text-muted">{c.body}</p>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => setAction(null)} disabled={saving} className="tap h-12 rounded-2xl bg-surface text-[15px] font-medium">Cancel</button>
                <button type="button" onClick={() => void apply()} disabled={saving}
                  className={`tap flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold ${c.danger ? "bg-danger text-white" : "bg-brand text-ink"}`}>
                  {saving && <Spinner />}{c.ok}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
