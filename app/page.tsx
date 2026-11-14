// Home page
import AuthGuard from "@/components/AuthGuard";

export default function Home() {
  return (
    <AuthGuard>
      <h1 className="text-xl font-semibold">Expenses</h1>
      <p className="mt-2 opacity-70">Coming soon.</p>
    </AuthGuard>
  );
}
