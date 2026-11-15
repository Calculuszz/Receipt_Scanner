"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

// แปลงข้อความ error จาก Supabase เป็นภาษาคน
function friendlyError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (m.includes("already registered"))
    return "อีเมลนี้ถูกใช้สมัครแล้ว ลองเข้าสู่ระบบแทน";
  if (m.includes("rate limit"))
    return "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (m.includes("at least 6"))
    return "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
  if (m.includes("email not confirmed"))
    return "ยังไม่ได้ยืนยันอีเมล กรุณาเช็กอีเมลของคุณ";
  if (m.includes("invalid email") || m.includes("unable to validate email"))
    return "รูปแบบอีเมลไม่ถูกต้อง";
  return "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // ถ้า login อยู่แล้ว ไม่ต้องอยู่หน้านี้ ให้เด้งไปหน้าแรก
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/");
      else setChecking(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (error) return setError(friendlyError(error.message));
      router.push("/");
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) return setError(friendlyError(error.message));
      if (!data.session) {
        // สมัครสำเร็จ แต่ต้องยืนยันอีเมลก่อน: ไม่ใช่ error ใช้สีเขียว
        return setInfo("สมัครสำเร็จ! เช็กอีเมลเพื่อยืนยันบัญชี แล้วกลับมาเข้าสู่ระบบ");
      }
      router.push("/");
    }
  }

  if (checking) return <p className="p-4 opacity-70">Loading...</p>;

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Receipt Scanner</h1>
        <p className="mt-1 text-sm opacity-70">
          ถ่ายรูปใบเสร็จ แล้วให้ AI ช่วยจดรายจ่ายและรวมยอดให้
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
        </h2>

        <input
          type="email"
          required
          autoComplete="email"
          placeholder="อีเมล"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border bg-transparent p-2"
        />

        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="รหัสผ่าน (อย่างน้อย 6 ตัว)"
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

        {mode === "login" && (
          <Link
            href="/forgot-password"
            className="text-right text-sm text-blue-600 underline"
          >
            ลืมรหัสผ่าน?
          </Link>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        {info && <p className="text-sm text-green-600">{info}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 p-2 font-medium text-white disabled:opacity-50"
        >
          {loading
            ? "กำลังดำเนินการ..."
            : mode === "login"
              ? "เข้าสู่ระบบ"
              : "สมัครสมาชิก"}
        </button>

        <p className="text-center text-sm">
          {mode === "login" ? (
            <>
              ยังไม่มีบัญชี?{" "}
              <Link href="/signup" className="text-blue-600 underline">
                สมัครสมาชิก
              </Link>
            </>
          ) : (
            <>
              มีบัญชีอยู่แล้ว?{" "}
              <Link href="/login" className="text-blue-600 underline">
                เข้าสู่ระบบ
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}