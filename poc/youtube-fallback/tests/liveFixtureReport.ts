import { createRequire } from "node:module";
import { resolveTrack } from "../server/index.js";
import { RuntimeCandidateCoordinator } from "../server/runtimeCandidateCoordinator.js";
import { TrackMatcher } from "../server/trackMatcher.js";
import {
  isPocConfigured,
  loadPocConfig,
  YouTubeDataApiClient,
} from "../server/youtubeClient.js";
import type {
  TrackIdentity,
  YouTubeClient,
  YouTubeSearchHit,
  YouTubeVideoDetails,
} from "../server/types.js";

interface Fixture {
  id: string;
  track: TrackIdentity;
}

interface ExpectedResult {
  id: string;
  expectedOutcome: "pending_manual" | "unmatched";
  expectedVideoId?: string | null;
  mustRejectVersion?: string;
}

const require = createRequire(import.meta.url);
const fixtures = require("../fixtures/tracks.json") as Fixture[];
const expectedResults = require("../fixtures/expected-results.json") as ExpectedResult[];
const expectedById = new Map(expectedResults.map((item) => [item.id, item]));
const config = loadPocConfig();

if (!isPocConfigured(config)) {
  console.error("YOUTUBE_API_KEY_REQUIRED: live fixture report was not run");
  process.exitCode = 1;
} else {
  const baseClient = new YouTubeDataApiClient(config);
  let searchCalls = 0;
  let videosCalls = 0;
  const countingClient: YouTubeClient = {
    async searchVideos(input): Promise<YouTubeSearchHit[]> {
      searchCalls += 1;
      return baseClient.searchVideos(input);
    },
    async listVideos(videoIds): Promise<YouTubeVideoDetails[]> {
      videosCalls += 1;
      return baseClient.listVideos(videoIds);
    },
  };
  const matcher = new TrackMatcher({ regionCode: config.regionCode });
  const coordinator = new RuntimeCandidateCoordinator();
  const rows: unknown[] = [];

  for (const fixture of fixtures) {
    searchCalls = 0;
    videosCalls = 0;
    const startedAt = Date.now();
    try {
      const result = await resolveTrack(fixture, config, countingClient, matcher, coordinator);
      rows.push({
        id: fixture.id,
        expected: expectedById.get(fixture.id) ?? null,
        actualKind: result.kind,
        actualVideoId: result.kind === "matched" ? result.candidate.videoId : null,
        actualCode: result.kind === "no_match" ? result.code : null,
        reasons: result.kind === "matched" ? result.reasons : result.rejected,
        candidates: result.candidates,
        apiCalls: { searchList: searchCalls, videosList: videosCalls },
        elapsedMs: Date.now() - startedAt,
        humanReview: "pending",
      });
    } catch (error) {
      rows.push({
        id: fixture.id,
        expected: expectedById.get(fixture.id) ?? null,
        actualKind: "error",
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        apiCalls: { searchList: searchCalls, videosList: videosCalls },
        elapsedMs: Date.now() - startedAt,
        humanReview: "blocked_by_error",
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        regionCode: config.regionCode,
        relevanceLanguage: config.relevanceLanguage,
        maxResults: config.maxResults,
        apiKeyExposed: false,
        rows,
      },
      null,
      2,
    ),
  );
}
