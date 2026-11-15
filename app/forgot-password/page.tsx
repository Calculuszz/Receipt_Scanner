// FORGOT-PASSWORD
"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("rate limit")
          ? "ส่งอีเมลบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"
          : "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
      );
      return;
    }
    setSent(true);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Receipt Scanner</h1>
        <p className="mt-1 text-sm opacity-70">รีเซ็ตรหัสผ่าน</p>
      </div>

      {sent ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-green-600">
            ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลของคุณแล้ว
            ถ้าไม่พบ ลองดูในกล่องสแปม และเปิดลิงก์ในเบราว์เซอร์นี้
          </p>
          <Link href="/login" className="text-center text-sm text-blue-600 underline">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้
          </p>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="อีเมล"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border bg-transparent p-2"
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 p-2 font-medium text-white disabled:opacity-50"
          >
            {loading ? "กำลังส่ง..." : "ส่งลิงก์รีเซ็ตรหัสผ่าน"}
          </button>
          <Link href="/login" className="text-center text-sm text-blue-600 underline">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </form>
      )}
    </div>
  );
}