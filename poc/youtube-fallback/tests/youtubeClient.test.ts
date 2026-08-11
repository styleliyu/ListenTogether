import assert from "node:assert/strict";
import {
  buildSearchQuery,
  parseIso8601DurationMs,
  YouTubeClientError,
  YouTubeDataApiClient,
  type FetchLike,
} from "../server/youtubeClient.js";
import type { YouTubePocConfig } from "../server/types.js";

const firstVideoId = "dQw4w9WgXcQ";
const secondVideoId = "9bZkp7q19f0";
const config: YouTubePocConfig = {
  apiKey: "server-only-test-key",
  regionCode: "HK",
  relevanceLanguage: "zh-Hans",
  maxResults: 10,
  requestTimeoutMs: 5000,
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function queuedFetch(responses: unknown[]): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    calls.push(input);
    const next = responses.shift();
    if (!next) throw new Error("UNEXPECTED_FETCH");
    return response(next);
  };
  return { fetchImpl, calls };
}

assert.equal(buildSearchQuery({ title: "  晴天  ", artists: [" 周杰伦 "] }), "晴天 周杰伦");
assert.equal(
  buildSearchQuery({ title: "Love Story (Taylor's Version)", artists: ["Taylor Swift"] }),
  "Love Story (Taylor's Version) Taylor Swift",
);
assert.throws(
  () => buildSearchQuery({ title: "", artists: ["artist"] }),
  (error: unknown) =>
    error instanceof YouTubeClientError && error.code === "INVALID_INPUT",
);

assert.equal(parseIso8601DurationMs("PT14.999S"), 14_999);
assert.equal(parseIso8601DurationMs("PT15S"), 15_000);
assert.equal(parseIso8601DurationMs("PT15.001S"), 15_001);
assert.equal(parseIso8601DurationMs("PT1H2M3S"), 3_723_000);
assert.equal(parseIso8601DurationMs("P1DT2H"), 93_600_000);
for (const invalid of ["P", "PT", "P1Y", "PT1S2M", "PT1.5H30M"]) {
  assert.throws(
    () => parseIso8601DurationMs(invalid),
    (error: unknown) =>
      error instanceof YouTubeClientError && error.code === "SCHEMA_INVALID",
  );
}

const { fetchImpl, calls } = queuedFetch([
  {
    items: [
      {
        id: { kind: "youtube#video", videoId: firstVideoId },
        snippet: {
          title: "晴天",
          channelTitle: "周杰伦",
          publishedAt: "2003-07-31T00:00:00Z",
        },
      },
    ],
  },
  {
    items: [
      {
        id: firstVideoId,
        snippet: {
          title: "晴天",
          channelTitle: "周杰伦",
          publishedAt: "2003-07-31T00:00:00Z",
        },
        contentDetails: {
          duration: "PT4M29.5S",
          regionRestriction: { allowed: ["HK"] },
        },
        status: {
          embeddable: true,
          madeForKids: false,
          privacyStatus: "public",
        },
      },
    ],
  },
]);

const client = new YouTubeDataApiClient(config, { fetchImpl });
const searchHits = await client.searchVideos({ title: "晴天", artists: ["周杰伦"] });
assert.deepEqual(searchHits, [
  {
    videoId: firstVideoId,
    title: "晴天",
    channelTitle: "周杰伦",
    publishedAt: "2003-07-31T00:00:00Z",
    searchRank: 0,
  },
]);

const videoDetails = await client.listVideos([firstVideoId, secondVideoId]);
assert.equal(videoDetails.length, 1, "missing videos.list items must be dropped");
assert.equal(videoDetails[0].durationMs, 269_500);
assert.equal(videoDetails[0].embeddable, true);
assert.deepEqual(videoDetails[0].regionRestriction?.allowed, ["HK"]);
assert.equal(videoDetails[0].regionRestriction?.blocked, undefined);
assert.equal(calls.length, 2, "one search call and one batch details call");

const searchUrl = new URL(calls[0]);
assert.equal(searchUrl.pathname, "/youtube/v3/search");
assert.equal(searchUrl.searchParams.get("q"), "晴天 周杰伦");
assert.equal(searchUrl.searchParams.get("maxResults"), "10");
assert.equal(searchUrl.searchParams.get("videoEmbeddable"), "true");
assert.equal(searchUrl.searchParams.get("videoSyndicated"), "true");
assert.equal(searchUrl.searchParams.get("key"), config.apiKey);
assert.equal(searchUrl.searchParams.get("statistics"), null);

const videosUrl = new URL(calls[1]);
assert.equal(videosUrl.pathname, "/youtube/v3/videos");
assert.equal(videosUrl.searchParams.get("id"), `${firstVideoId},${secondVideoId}`);
assert.equal(videosUrl.searchParams.get("part"), "snippet,contentDetails,status");
assert.equal(videosUrl.searchParams.get("key"), config.apiKey);

const emptyClient = new YouTubeDataApiClient(config, {
  fetchImpl: async () => {
    throw new Error("listVideos([]) must not fetch");
  },
});
assert.deepEqual(await emptyClient.listVideos([]), []);

const malformedClient = new YouTubeDataApiClient(config, {
  fetchImpl: async () => response({ items: [{ id: {} }] }),
});
await assert.rejects(
  () => malformedClient.searchVideos({ title: "晴天", artists: ["周杰伦"] }),
  (error: unknown) =>
    error instanceof YouTubeClientError && error.code === "SCHEMA_INVALID",
);

const unconfiguredClient = new YouTubeDataApiClient(
  { ...config, apiKey: undefined },
  {
    fetchImpl: async () => {
      throw new Error("unconfigured client must not fetch");
    },
  },
);
await assert.rejects(
  () => unconfiguredClient.searchVideos({ title: "晴天", artists: ["周杰伦"] }),
  (error: unknown) =>
    error instanceof YouTubeClientError && error.code === "MISCONFIGURED",
);

const timeoutClient = new YouTubeDataApiClient(
  { ...config, requestTimeoutMs: 5 },
  {
    fetchImpl: async (_input, init) =>
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("ABORT")), {
          once: true,
        });
      }),
  },
);
await assert.rejects(
  () => timeoutClient.searchVideos({ title: "晴天", artists: ["周杰伦"] }),
  (error: unknown) =>
    error instanceof YouTubeClientError && error.code === "TIMEOUT",
);

console.log("youtube client contract ok: query, batch, schema, timeout boundary");
