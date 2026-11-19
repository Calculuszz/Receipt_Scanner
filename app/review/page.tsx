// Review: the treasurer checks new receipts, sends them back with a reason, and marks them paid
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/AppShell";
import RoleGate from "@/components/RoleGate";
import ReviewQueue from "@/components/ReviewQueue";

export default function ReviewPage() {
  return (
    <AuthGuard>
      <AppShell title="Review">
        <RoleGate need="admin">
          <ReviewQueue />
        </RoleGate>
      </AppShell>
    </AuthGuard>
  );
}
