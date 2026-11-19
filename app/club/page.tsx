// Club: everyone's receipts (admins only), filterable by event
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/AppShell";
import ExpenseList from "@/components/ExpenseList";
import RoleGate from "@/components/RoleGate";

export default function ClubPage() {
  return (
    <AuthGuard>
      <AppShell title="Club spending">
        <RoleGate need="admin">
          <ExpenseList mode="club" />
        </RoleGate>
      </AppShell>
    </AuthGuard>
  );
}
