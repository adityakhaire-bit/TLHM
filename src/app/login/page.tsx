import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signIn } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createSupabaseServerClient();
  if (supabase && (await supabase.auth.getUser()).data.user) redirect("/");
  const { error } = await searchParams;
  return <main className="grid min-h-screen place-items-center bg-[#f7f8fa] px-5">
    <section className="w-full max-w-[400px] rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="grid size-10 place-items-center rounded-xl bg-[#182230] text-sm font-bold text-white">TM</div>
      <h1 className="mt-6 text-xl font-semibold">Sign in to Media Hub</h1>
      <p className="mt-1 text-sm text-slate-500">Use your company account to access the creative library.</p>
      {error && <p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>}
      {!supabase && <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Configure Supabase in .env.local before signing in.</p>}
      <form action={signIn} className="mt-6 space-y-4">
        <label className="block text-sm font-medium">Email<input required name="email" type="email" autoComplete="email" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /></label>
        <label className="block text-sm font-medium">Password<input required name="password" type="password" autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /></label>
        <button disabled={!supabase} className="w-full rounded-lg bg-[#182230] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">Sign in</button>
      </form>
      <p className="mt-5 text-xs leading-5 text-slate-500">Accounts are provisioned by a workspace administrator. Public sign-up is disabled.</p>
    </section>
  </main>;
}
