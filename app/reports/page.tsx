// Reports: events with budgets, spending per event, and CSV export
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/AppShell";
import Reports from "@/components/Reports";
import RoleGate from "@/components/RoleGate";

export default function ReportsPage() {
  return (
    <AuthGuard>
      <AppShell title="Reports">
        <RoleGate need="admin">
          <Reports />
        </RoleGate>
      </AppShell>
    </AuthGuard>
  );
}
