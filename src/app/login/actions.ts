"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?error=Enter%20your%20email%20and%20password");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?error=Supabase%20is%20not%20configured");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=Sign-in%20failed.%20Check%20your%20credentials");
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/login");
}
