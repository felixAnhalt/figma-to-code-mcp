import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { fetchNodesBatch } from "~/figma/batchFetch";
import { FigmaService } from "~/services/figmaConnector";

config();

const NODE_IDS = [
  "10081:57101",
  "378:1347",
  "465:541",
  "474:336",
  "465:713",
  "465:481",
  "20457:247",
  "46894:132806",
  "3663:1483",
];

describe.skipIf(process.env.RUN_FIGMA_INTEGRATION !== "1")(
  "fetchNodesBatch integration test",
  () => {
    const figmaApiKey = process.env.FIGMA_API_KEY || "";
    const figmaFileKey = process.env.FIGMA_FILE_KEY || "";

    it("should fetch each node ID individually", async () => {
      if (!figmaApiKey || !figmaFileKey) {
        throw new Error("FIGMA_API_KEY and FIGMA_FILE_KEY environment variables are required.");
      }

      const figmaService = new FigmaService({
        figmaApiKey,
        figmaOAuthToken: "",
        useOAuth: false,
      });

      const authHeaders = figmaService.getAuthHeaders();

      for (const nodeId of NODE_IDS) {
        console.log(`Fetching node: ${nodeId}...`);
        try {
          const result = await fetchNodesBatch(figmaFileKey, [nodeId], authHeaders);
          console.log(`  ✓ Success: ${Object.keys(result).length} node(s) returned`);
          expect(result).toBeDefined();
          expect(result[nodeId]).toBeDefined();
        } catch (error) {
          console.log(`  ✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      }
    }, 120000);
  },
);
