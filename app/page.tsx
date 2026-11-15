// Home page: this month's spending and the receipts list
import AuthGuard from "@/components/AuthGuard";
import ExpenseList from "@/components/ExpenseList";

export default function Home() {
  return (
    <AuthGuard>
      <ExpenseList />
    </AuthGuard>
  );
}
