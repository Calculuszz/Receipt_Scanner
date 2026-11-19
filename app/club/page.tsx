// Club: everyone's receipts (treasurer and viewers), filterable by event
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/AppShell";
import ExpenseList from "@/components/ExpenseList";
import RoleGate from "@/components/RoleGate";

export default function ClubPage() {
  return (
    <AuthGuard>
      <AppShell title="Club spending">
        <RoleGate need="club">
          <ExpenseList mode="club" />
        </RoleGate>
      </AppShell>
    </AuthGuard>
  );
}
