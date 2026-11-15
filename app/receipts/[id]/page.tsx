// Receipt detail page: photo (signed URL), details, edit and delete
import { Suspense } from "react";
import AuthGuard from "@/components/AuthGuard";
import ReceiptDetail from "@/components/ReceiptDetail";

export default function ReceiptDetailPage() {
  return (
    <AuthGuard>
      {/* useParams reads a dynamic segment, so it must sit inside Suspense (Cache Components) */}
      <Suspense fallback={<p className="opacity-70">Loading receipt...</p>}>
        <ReceiptDetail />
      </Suspense>
    </AuthGuard>
  );
}
