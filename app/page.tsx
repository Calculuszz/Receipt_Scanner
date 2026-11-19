// Home: your own spending and receipts, with their review status
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/AppShell";
import ExpenseList from "@/components/ExpenseList";

export default function Home() {
  return (
    <AuthGuard>
      <AppShell title="My receipts">
        <ExpenseList mode="mine" />
      </AppShell>
    </AuthGuard>
  );
}
