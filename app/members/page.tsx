// Members: club admins see everyone who signed up and can add or remove admins
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/AppShell";
import MemberList from "@/components/MemberList";
import RoleGate from "@/components/RoleGate";

export default function MembersPage() {
  return (
    <AuthGuard>
      <AppShell title="Members">
        <RoleGate need="admin">
          <MemberList />
        </RoleGate>
      </AppShell>
    </AuthGuard>
  );
}
