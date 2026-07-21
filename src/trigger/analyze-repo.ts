import { logger, metadata, schemaTask, tags } from "@trigger.dev/sdk";
import { z } from "zod";
import { fetchRepoRow } from "../lib/github-repo";
import { analyzeAndStoreRepo } from "../lib/repo-analysis";

const analyzeRepoSchema = z.object({
  repoName: z.string().min(1),
  repoUrl: z.string().url().optional(),
});

export const analyzeRepo = schemaTask({
  id: "analyze-repo",
  schema: analyzeRepoSchema,
  maxDuration: 300,
  run: async ({ repoName }) => {
    await tags.add("analysis");
    metadata.set("status", "Starting analysis...");
    metadata.set("repository", repoName);

    logger.log("Starting repo analysis", { repoName });

    metadata.set("status", "Fetching repository metadata...");
    const repoRow = await fetchRepoRow(repoName);

    metadata.set("status", "Analyzing codebase structure...");
    const analysis = await analyzeAndStoreRepo(
      repoName,
      repoRow?.language,
      repoRow?.topics
    );

    if (!analysis) {
      metadata.set("status", "Analysis failed");
      throw new Error(`Failed to analyze repository ${repoName}`);
    }

    metadata.set("status", "Completed");
    logger.log("Successfully analyzed repository", { repoName, techStack: analysis.tech_stack });

    return {
      repoName,
      overview: analysis.overview,
      techStack: analysis.tech_stack,
      keyFiles: analysis.key_files,
      architectureSummary: analysis.architecture_summary,
      status: "completed",
    };
  },
});
