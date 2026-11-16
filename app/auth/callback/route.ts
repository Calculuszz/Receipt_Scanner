// Google sign-in lands here: swap the one-time code for a session cookie, then go home.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // Only same-site paths, so the link can't bounce users to another website.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(target, url.origin));
  }

  // Cancelled at Google, expired link, or redirect URL not allowed in Supabase.
  return NextResponse.redirect(new URL("/login?error=google", url.origin));
}
