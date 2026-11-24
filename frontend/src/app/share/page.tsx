import { headers } from "next/headers";
import { Share2 } from "lucide-react";
import { AppShell, PageHeading } from "@/components/app-shell";
import { requirePageUser } from "@/server/auth";
import { lanGuestEnabled, shareLinks } from "@/server/lan-access";
import { SharePanel } from "./share-panel";

export const dynamic = "force-dynamic";

export default async function SharePage() {
  const user = await requirePageUser();
  const links = shareLinks((await headers()).get("host"));
  return (
    <AppShell user={user} active="share" crumb="Share with team">
      <div className="mx-auto max-w-[900px] px-4 py-9 md:px-10">
        <PageHeading icon={Share2} title="Share with your team" subtitle="Anyone on the office Wi-Fi can open the media hub with one of these links. No Firebase or IP setup needed." />
        <SharePanel links={links} guestEnabled={await lanGuestEnabled()} isAdmin={user.role === "admin"} />
      </div>
    </AppShell>
  );
}
