// Home page
import AuthGuard from "@/components/AuthGuard";
import ExpenseList from "@/components/ExpenseList";

export default function Home() {
  return (
    <AuthGuard>
      <h1 className="mb-4 text-xl font-semibold">Expenses</h1>
      <ExpenseList />
    </AuthGuard>
  );
}