"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // เมื่อเปิดลิงก์จากอีเมล Supabase จะสร้าง session ชั่วคราวให้เอง
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // ถ้าไม่มี session ภายใน 2.5 วินาที แปลว่าลิงก์ไม่ถูกต้องหรือหมดอายุ
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
      else setExpired(true);
    }, 2500);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("at least 6")
          ? "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"
          : error.message.toLowerCase().includes("different")
            ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม"
            : "ตั้งรหัสผ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
      );
      return;
    }
    setDone(true);
    setTimeout(() => router.replace("/"), 1500);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Receipt Scanner</h1>
        <p className="mt-1 text-sm opacity-70">ตั้งรหัสผ่านใหม่</p>
      </div>

      {done ? (
        <p className="text-center text-sm text-green-600">
          เปลี่ยนรหัสผ่านสำเร็จ กำลังพาไปหน้าแรก...
        </p>
      ) : ready ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border bg-transparent p-2 pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sm opacity-70"
            >
              {showPassword ? "ซ่อน" : "แสดง"}
            </button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 p-2 font-medium text-white disabled:opacity-50"
          >
            {loading ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
          </button>
        </form>
      ) : expired ? (
        <div className="flex flex-col gap-3 text-center">
          <p className="text-sm text-red-500">
            ลิงก์ไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่
          </p>
          <Link href="/forgot-password" className="text-sm text-blue-600 underline">
            ขอลิงก์รีเซ็ตรหัสผ่านอีกครั้ง
          </Link>
        </div>
      ) : (
        <p className="text-center opacity-70">กำลังตรวจสอบลิงก์...</p>
      )}
    </div>
  );
}