import { Archive } from "lucide-react";
import { AppShell, PageHeading } from "@/components/app-shell";
import { LibraryBrowser } from "@/components/library-browser";
import { requirePageUser } from "@/server/auth";

export const dynamic = "force-dynamic";

const ACTIVE = { video: "video", audio: "audio", image: "image" } as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const active = ACTIVE[query.type as keyof typeof ACTIVE] ?? "all";
  return (
    <AppShell user={user} active={active} crumb="Library" query={query.q}>
      <div className="mx-auto max-w-[1440px] px-4 py-9 md:px-10">
        <PageHeading icon={Archive} title="Media library" subtitle="Every file stored on the media drive. Click a card to preview, edit or download." />
        <LibraryBrowser role={user.role} initialQuery={query} />
      </div>
    </AppShell>
  );
}
