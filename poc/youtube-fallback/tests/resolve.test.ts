import assert from "node:assert/strict";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPocServer, POC_API_PREFIX } from "../server/index.js";
import { YouTubeClientError } from "../server/youtubeClient.js";
import type {
  ResolveRequest,
  TrackIdentity,
  YouTubeClient,
  YouTubePocConfig,
  YouTubeSearchHit,
  YouTubeVideoDetails,
} from "../server/types.js";

const config: YouTubePocConfig = {
  apiKey: "server-only-test-key",
  regionCode: "HK",
  relevanceLanguage: "zh-Hans",
  maxResults: 10,
  requestTimeoutMs: 5000,
};

const track: TrackIdentity = {
  title: "晴天",
  artists: ["周杰伦"],
  durationMs: 180_000,
  origin: { provider: "netease", resourceId: "netease-123" },
};

const firstHit: YouTubeSearchHit = {
  videoId: "dQw4w9WgXcQ",
  title: "晴天",
  channelTitle: "周杰伦",
  searchRank: 0,
};

const secondHit: YouTubeSearchHit = {
  videoId: "9bZkp7q19f0",
  title: "晴天 (Live)",
  channelTitle: "周杰伦",
  searchRank: 1,
};

const firstCandidate: YouTubeVideoDetails = {
  ...firstHit,
  durationMs: 180_000,
  embeddable: true,
  madeForKids: false,
};

const secondCandidate: YouTubeVideoDetails = {
  ...secondHit,
  durationMs: 180_000,
  embeddable: true,
  madeForKids: false,
};

function mockClient(
  searchHits: YouTubeSearchHit[],
  candidates: YouTubeVideoDetails[],
  searchError?: Error,
): YouTubeClient & { searchCalls: number; listCalls: string[][] } {
  const state = { searchCalls: 0, listCalls: [] as string[][] };
  return {
    get searchCalls() {
      return state.searchCalls;
    },
    get listCalls() {
      return state.listCalls;
    },
    async searchVideos() {
      state.searchCalls += 1;
      if (searchError) throw searchError;
      return searchHits;
    },
    async listVideos(videoIds) {
      state.listCalls.push([...videoIds]);
      return candidates;
    },
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function postResolve(port: number, body: unknown): Promise<{ status: number; payload: any }> {
  return postJson(port, `${POC_API_PREFIX}/resolve`, body);
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: any }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          try {
            resolve({ status: response.statusCode ?? 0, payload: JSON.parse(responseBody) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

async function get(port: number, path: string): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path, method: "GET" },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: String(response.headers["content-type"] ?? ""),
            body,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const validRequest: ResolveRequest = { track };

{
  const client = mockClient([firstHit, secondHit], [firstCandidate, secondCandidate]);
  const server = createPocServer(config, { client });
  const port = await listen(server);
  try {
    const response = await postResolve(port, validRequest);
    assert.equal(response.status, 200);
    assert.equal(response.payload.kind, "matched");
    assert.equal(response.payload.candidate.videoId, firstCandidate.videoId);
    assert.deepEqual(
      response.payload.candidates.map((item: any) => [item.candidate.videoId, item.decision]),
      [
        [firstCandidate.videoId, "selected"],
        [secondCandidate.videoId, "rejected"],
      ],
    );
    assert.ok(response.payload.candidates[1].reasons.includes("VERSION_CONFLICT"));
    assert.equal(response.payload.search.query, "晴天 周杰伦");
    assert.deepEqual(response.payload.search.missingVideoIds, []);
    assert.equal(client.searchCalls, 1);
    assert.deepEqual(client.listCalls, [[firstHit.videoId, secondHit.videoId]]);
  } finally {
    await close(server);
  }
}

{
  const client = mockClient([], []);
  const server = createPocServer(config, { client });
  const port = await listen(server);
  try {
    const response = await postResolve(port, validRequest);
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload, {
      kind: "no_match",
      code: "NO_SEARCH_RESULTS",
      rejected: [],
      candidates: [],
      search: {
        query: "晴天 周杰伦",
        searchCount: 0,
        candidateCount: 0,
        missingVideoIds: [],
      },
    });
    assert.equal(client.searchCalls, 1);
    assert.deepEqual(client.listCalls, []);
  } finally {
    await close(server);
  }
}

{
  const client = mockClient([firstHit, secondHit], []);
  const server = createPocServer(config, { client });
  const port = await listen(server);
  try {
    const response = await postResolve(port, validRequest);
    assert.equal(response.status, 200);
    assert.equal(response.payload.kind, "no_match");
    assert.equal(response.payload.code, "NO_VIDEO_DETAILS");
    assert.deepEqual(response.payload.candidates, []);
    assert.deepEqual(response.payload.search.missingVideoIds, [firstHit.videoId, secondHit.videoId]);
    assert.deepEqual(client.listCalls, [[firstHit.videoId, secondHit.videoId]]);
  } finally {
    await close(server);
  }
}

{
  const server = createPocServer(config, { client: mockClient([], []) });
  const port = await listen(server);
  try {
    const response = await postResolve(port, {
      track: { title: "", artists: [], origin: { provider: "netease", resourceId: "" } },
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.kind, "error");
    assert.equal(response.payload.code, "INVALID_TRACK_REQUEST");
    assert.ok(response.payload.errors.includes("TITLE_REQUIRED"));
    assert.ok(response.payload.errors.includes("ARTIST_REQUIRED"));
    assert.ok(response.payload.errors.includes("ORIGIN_RESOURCE_ID_REQUIRED"));
  } finally {
    await close(server);
  }
}

{
  const noKeyConfig: YouTubePocConfig = { ...config, apiKey: undefined };
  const server = createPocServer(noKeyConfig);
  const port = await listen(server);
  try {
    const response = await postResolve(port, validRequest);
    assert.equal(response.status, 503);
    assert.deepEqual(response.payload, {
      kind: "error",
      code: "MISCONFIGURED",
      message: "YOUTUBE_API_KEY_REQUIRED",
    });
  } finally {
    await close(server);
  }
}

{
  const client = mockClient([], [], new YouTubeClientError("TIMEOUT", "YOUTUBE_REQUEST_TIMEOUT"));
  const server = createPocServer(config, { client });
  const port = await listen(server);
  try {
    const response = await postResolve(port, validRequest);
    assert.equal(response.status, 502);
    assert.deepEqual(response.payload, {
      kind: "error",
      code: "TEMPORARILY_UNAVAILABLE",
      message: "YOUTUBE_UPSTREAM_UNAVAILABLE",
    });
  } finally {
    await close(server);
  }
}


{
  const server = createPocServer(config, { client: mockClient([], []) });
  const port = await listen(server);
  try {
    const [page, script, fallbackScript, stylesheet] = await Promise.all([
      get(port, "/"),
      get(port, "/main.js"),
      get(port, "/playerFallback.js"),
      get(port, "/poc.css"),
    ]);
    assert.equal(page.status, 200);
    assert.match(page.contentType, /^text\/html/);
    assert.match(page.body, /YouTube fallback/);
    assert.match(page.body, /加载 YouTube 官方示例视频/);
    assert.equal(script.status, 200);
    assert.match(script.contentType, /^text\/javascript/);
    assert.match(script.body, /youtube-fallback/);
    assert.equal(fallbackScript.status, 200);
    assert.match(fallbackScript.contentType, /^text\/javascript/);
    assert.match(fallbackScript.body, /isRuntimeSourceFailure/);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.contentType, /^text\/css/);
  } finally {
    await close(server);
  }
}

{
  const alternateHit: YouTubeSearchHit = {
    videoId: "alternate01",
    title: "晴天 歌词",
    channelTitle: "周杰伦",
    searchRank: 1,
  };
  const alternateCandidate: YouTubeVideoDetails = {
    ...alternateHit,
    durationMs: 180_000,
    embeddable: true,
    madeForKids: false,
  };
  const client = mockClient(
    [firstHit, alternateHit],
    [firstCandidate, alternateCandidate],
  );
  const server = createPocServer(config, { client });
  const port = await listen(server);
  try {
    const initial = await postResolve(port, validRequest);
    assert.equal(initial.payload.kind, "matched");
    assert.equal(typeof initial.payload.resolutionId, "string");

    const switched = await postJson(port, `${POC_API_PREFIX}/runtime-failure`, {
      resolutionId: initial.payload.resolutionId,
      videoId: firstCandidate.videoId,
      errorCode: 150,
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.payload.kind, "switched");
    assert.equal(switched.payload.candidate.videoId, alternateCandidate.videoId);

    const exhausted = await postJson(port, `${POC_API_PREFIX}/runtime-failure`, {
      resolutionId: initial.payload.resolutionId,
      videoId: alternateCandidate.videoId,
      errorCode: 101,
    });
    assert.equal(exhausted.status, 200);
    assert.equal(exhausted.payload.kind, "exhausted");

    const cached = await postResolve(port, validRequest);
    assert.equal(cached.payload.kind, "no_match");
    assert.equal(cached.payload.code, "RUNTIME_FAILURE_CACHE");
    assert.ok(
      cached.payload.candidates.every((item: any) =>
        item.reasons.includes("RUNTIME_FAILURE_CACHE"),
      ),
    );
    assert.equal(client.searchCalls, 2);
    assert.equal(client.listCalls.length, 2);
  } finally {
    await close(server);
  }
}

console.log("resolve contract ok: match, candidate decisions, validation, empty search, static page, error mapping");
