import { FolderTree } from "lucide-react";
import { AppShell, PageHeading } from "@/components/app-shell";
import { requirePageUser } from "@/server/auth";
import { FolderBrowser } from "./folder-browser";

export const dynamic = "force-dynamic";

export default async function FoldersPage() {
  const user = await requirePageUser();
  return (
    <AppShell user={user} active="folders" crumb="Folders">
      <div className="mx-auto max-w-[1200px] px-4 py-9 md:px-10">
        <PageHeading icon={FolderTree} title="Folder structure" subtitle="Create, nest, move and rename library folders. Deleting a folder never deletes media." />
        <FolderBrowser canEdit={user.role !== "viewer"} />
      </div>
    </AppShell>
  );
}
