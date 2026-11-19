// Notifications: sent back, approved, paid; new receipts to check; events over budget
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/AppShell";
import NotificationList from "@/components/NotificationList";

export default function NotificationsPage() {
  return (
    <AuthGuard>
      <AppShell title="Notifications">
        <NotificationList />
      </AppShell>
    </AuthGuard>
  );
}
