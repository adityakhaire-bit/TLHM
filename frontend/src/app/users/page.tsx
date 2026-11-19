import { Users } from "lucide-react";
import { AppShell, PageHeading } from "@/components/app-shell";
import { requirePageUser } from "@/server/auth";
import { allowedDomains } from "@/server/google-auth";
import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requirePageUser();
  return (
    <AppShell user={user} active="users" crumb="Users">
      <div className="mx-auto max-w-[1200px] px-4 py-9 md:px-10">
        <PageHeading icon={Users} title="Users & access" subtitle="Who can use the media hub, and what they are allowed to do." />
        {user.role === "admin"
          ? <UsersTable currentUserId={user.id} allowedDomains={allowedDomains()} />
          : <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Only administrators can manage users.</p>}
      </div>
    </AppShell>
  );
}
