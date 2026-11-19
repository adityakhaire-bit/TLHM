import { redirect } from "next/navigation";
import { optionalPageUser } from "@/server/auth";
import { allowedDomains } from "@/server/google-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function Login() {
  if (await optionalPageUser()) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f8fa] px-5">
      <section className="w-full max-w-[400px] rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="grid size-10 place-items-center rounded-xl bg-[#182230] text-sm font-bold text-white">TM</div>
        <h1 className="mt-6 text-xl font-semibold">Sign in to Media Hub</h1>
        <p className="mt-1 text-sm text-slate-500">Use your company account to access the creative library.</p>
        <LoginForm googleDomains={allowedDomains()} />
        <p className="mt-5 text-xs leading-5 text-slate-500">Team members sign in or create an account with their company email. New accounts start with view-only access.</p>
      </section>
    </main>
  );
}
