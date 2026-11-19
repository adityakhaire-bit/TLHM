/**
 * Queue AI analysis for existing videos (the worker then processes them).
 *   npm run ai:analyze                 → every video that has no AI metadata yet
 *   npm run ai:analyze -- --all        → every video (re-analyse everything)
 *   npm run ai:analyze -- --id <uuid>  → one video
 */
import "./load-env";
import { queueAnalysis } from "@/server/ai-analysis";
import { prisma } from "@/server/db";
import { geminiConfigured } from "@/server/gemini";

async function main() {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY is empty in .env");
  const idIndex = process.argv.indexOf("--id");
  const all = process.argv.includes("--all");
  const videos = await prisma.mediaFile.findMany({
    where: {
      mediaType: "video", deletedAt: null,
      ...(idIndex > -1 ? { id: process.argv[idIndex + 1] } : {}),
      ...(all || idIndex > -1 ? {} : { analysis: { is: null } }),
    },
    select: { id: true, originalFilename: true },
    orderBy: { createdAt: "asc" },
  });
  for (const video of videos) {
    await queueAnalysis(video.id);
    console.log(`queued ${video.originalFilename} (${video.id})`);
  }
  console.log(`${videos.length} video(s) queued. The worker analyses them in the background.`);
}

main()
  .catch((error) => { console.error(`Error: ${(error as Error).message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
