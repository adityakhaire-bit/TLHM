import { Upload } from "lucide-react";
import { AppShell, PageHeading } from "@/components/app-shell";
import { requirePageUser } from "@/server/auth";
import { getEnv } from "@/server/env";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadsPage() {
  const user = await requirePageUser();
  return (
    <AppShell user={user} active="uploads" crumb="Upload centre">
      <div className="mx-auto max-w-[1200px] px-4 py-9 md:px-10">
        <PageHeading icon={Upload} title="Upload media" subtitle="Add videos, audio and images to the shared library." />
        {user.role === "viewer"
          ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Your account can browse and download, but not upload. Ask an administrator for the editor role.</p>
          : <UploadForm maxUploadBytes={getEnv().MAX_UPLOAD_BYTES} />}
      </div>
    </AppShell>
  );
}
