import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSearchQuery,
  isPocConfigured,
  loadPocConfig,
  YouTubeClientError,
  YouTubeDataApiClient,
} from "./youtubeClient.js";
import { TrackMatcher, validateTrackIdentity } from "./trackMatcher.js";
import { RuntimeCandidateCoordinator } from "./runtimeCandidateCoordinator.js";
import type {
  OriginProvider,
  ResolveCandidateView,
  ResolveRequest,
  ResolveResponse,
  ResolveSearchSummary,
  RuntimeFailureRequest,
  RuntimeFailureResponse,
  TrackMatchResult,
  TrackIdentity,
  YouTubeClient,
  YouTubePocConfig,
} from "./types.js";

export const POC_API_PREFIX = "/api/poc/youtube-fallback";

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(payload);
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 128 * 1024) {
        reject(new Error("REQUEST_TOO_LARGE"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    request.on("error", reject);
  });
}

const ORIGIN_PROVIDERS: readonly OriginProvider[] = [
  "netease",
  "tencent",
  "kugou",
  "kuwo",
  "baidu",
  "local",
  "unknown",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getResolveRequestErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["REQUEST_OBJECT_REQUIRED"];

  const track = value.track;
  if (!isRecord(track)) return ["TRACK_REQUIRED"];

  if (typeof track.title !== "string" || !track.title.trim()) {
    errors.push("TITLE_REQUIRED");
  }

  if (!Array.isArray(track.artists)) {
    errors.push("ARTIST_REQUIRED");
  } else {
    if (
      track.artists.length === 0 ||
      !track.artists.some((artist) => typeof artist === "string" && artist.trim())
    ) {
      errors.push("ARTIST_REQUIRED");
    }
    if (track.artists.some((artist) => typeof artist !== "string")) {
      errors.push("ARTIST_INVALID");
    }
  }

  const durationMs = track.durationMs;
  if (
    durationMs !== undefined &&
    (typeof durationMs !== "number" ||
      !Number.isInteger(durationMs) ||
      durationMs <= 0)
  ) {
    errors.push("DURATION_INVALID");
  }
  if (track.album !== undefined && typeof track.album !== "string") {
    errors.push("ALBUM_INVALID");
  }
  if (track.isrc !== undefined && typeof track.isrc !== "string") {
    errors.push("ISRC_INVALID");
  }

  if (!isRecord(track.origin)) {
    errors.push("ORIGIN_REQUIRED");
  } else {
    if (
      typeof track.origin.provider !== "string" ||
      !ORIGIN_PROVIDERS.includes(track.origin.provider as OriginProvider)
    ) {
      errors.push("ORIGIN_PROVIDER_INVALID");
    }
    if (
      typeof track.origin.resourceId !== "string" ||
      !track.origin.resourceId.trim()
    ) {
      errors.push("ORIGIN_RESOURCE_ID_REQUIRED");
    }
  }

  if (errors.length === 0) {
    errors.push(...validateTrackIdentity(track as unknown as TrackIdentity));
  }
  return [...new Set(errors)];
}

function asResolveRequest(value: unknown): ResolveRequest {
  return value as ResolveRequest;
}

function asRuntimeFailureRequest(value: unknown): RuntimeFailureRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.resolutionId !== "string" || !value.resolutionId.trim()) return undefined;
  if (typeof value.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/u.test(value.videoId)) {
    return undefined;
  }
  if (value.errorCode !== 100 && value.errorCode !== 101 && value.errorCode !== 150) {
    return undefined;
  }
  return value as unknown as RuntimeFailureRequest;
}

function healthPayload(config: YouTubePocConfig) {
  return {
    kind: "health",
    service: "youtube-fallback-poc",
    fallbackEnabled: isPocConfigured(config),
    regionCode: config.regionCode,
    relevanceLanguage: config.relevanceLanguage,
    maxResults: config.maxResults,
  };
}

export interface PocServerDependencies {
  client?: YouTubeClient;
  matcher?: TrackMatcher;
  coordinator?: RuntimeCandidateCoordinator;
}

function searchSummary(
  query: string,
  searchCount: number,
  candidateCount: number,
  missingVideoIds: string[] = [],
): ResolveSearchSummary {
  return { query, searchCount, candidateCount, missingVideoIds };
}

function describeCandidates(
  track: TrackIdentity,
  candidates: readonly ResolveCandidateView["candidate"][],
  result: TrackMatchResult,
  matcher: TrackMatcher,
): ResolveCandidateView[] {
  const rejectedById = new Map(
    result.kind === "unmatched"
      ? result.rejected.map((item) => [item.videoId, item.reasons] as const)
      : [],
  );

  return candidates.map((candidate) => {
    if (result.kind === "matched" && result.candidate.videoId === candidate.videoId) {
      return { candidate, decision: "selected", reasons: result.reasons };
    }

    const globalRejection = rejectedById.get(candidate.videoId);
    if (globalRejection) {
      return { candidate, decision: "rejected", reasons: globalRejection };
    }

    const individualResult = matcher.match(track, [candidate]);
    return individualResult.kind === "matched"
      ? { candidate, decision: "eligible", reasons: individualResult.reasons }
      : {
          candidate,
          decision: "rejected",
          reasons:
            individualResult.rejected.find((item) => item.videoId === candidate.videoId)
              ?.reasons ?? [individualResult.code],
        };
  });
}

export async function resolveTrack(
  request: ResolveRequest,
  config: YouTubePocConfig,
  client: YouTubeClient,
  matcher: TrackMatcher,
  coordinator: RuntimeCandidateCoordinator,
): Promise<Exclude<ResolveResponse, { kind: "error" }>> {
  const query = buildSearchQuery({
    title: request.track.title,
    artists: request.track.artists,
  });
  const searchHits = (await client.searchVideos({
    title: request.track.title,
    artists: request.track.artists,
  })).slice(0, config.maxResults);
  const videoIds = [...new Set(searchHits.map((hit) => hit.videoId))];

  if (videoIds.length === 0) {
    return {
      kind: "no_match",
      code: "NO_SEARCH_RESULTS",
      rejected: [],
      candidates: [],
      search: searchSummary(query, 0, 0),
    };
  }

  const candidates = await client.listVideos(videoIds);
  const candidateIds = new Set(candidates.map((candidate) => candidate.videoId));
  const missingVideoIds = videoIds.filter((videoId) => !candidateIds.has(videoId));
  const summary = searchSummary(query, videoIds.length, candidates.length, missingVideoIds);

  if (candidates.length === 0) {
    return {
      kind: "no_match",
      code: "NO_VIDEO_DETAILS",
      rejected: [],
      candidates: [],
      search: summary,
    };
  }

  const availableCandidates = coordinator.filterRuntimeRejected(candidates, config.regionCode);
  if (availableCandidates.length === 0) {
    return {
      kind: "no_match",
      code: "RUNTIME_FAILURE_CACHE",
      rejected: candidates.map((candidate) => ({
        videoId: candidate.videoId,
        reasons: ["RUNTIME_FAILURE_CACHE"],
      })),
      candidates: candidates.map((candidate) => ({
        candidate,
        decision: "rejected",
        reasons: ["RUNTIME_FAILURE_CACHE"],
      })),
      search: summary,
    };
  }

  const result = matcher.match(request.track, availableCandidates);
  const availableViews = describeCandidates(request.track, availableCandidates, result, matcher);
  const availableViewById = new Map(
    availableViews.map((view) => [view.candidate.videoId, view] as const),
  );
  const candidateViews = candidates.map(
    (candidate): ResolveCandidateView =>
      availableViewById.get(candidate.videoId) ?? {
        candidate,
        decision: "rejected",
        reasons: ["RUNTIME_FAILURE_CACHE"],
      },
  );
  return result.kind === "matched"
    ? {
        kind: "matched",
        resolutionId: coordinator.createResolution(
          candidateViews,
          result.candidate.videoId,
          config.regionCode,
        ),
        candidate: result.candidate,
        reasons: result.reasons,
        candidates: candidateViews,
        search: summary,
      }
    : {
        kind: "no_match",
        code: result.code,
        rejected: result.rejected,
        candidates: candidateViews,
        search: summary,
      };
}

const sourceWebRoot = fileURLToPath(new URL("../../web/", import.meta.url));
const compiledWebRoot = fileURLToPath(new URL("../web/", import.meta.url));

const WEB_ASSETS: Readonly<Record<string, { path: string; contentType: string }>> = {
  "/": { path: resolve(sourceWebRoot, "index.html"), contentType: "text/html; charset=utf-8" },
  "/index.html": { path: resolve(sourceWebRoot, "index.html"), contentType: "text/html; charset=utf-8" },
  "/poc.css": { path: resolve(sourceWebRoot, "poc.css"), contentType: "text/css; charset=utf-8" },
  "/main.js": { path: resolve(compiledWebRoot, "main.js"), contentType: "text/javascript; charset=utf-8" },
  "/playerFallback.js": { path: resolve(compiledWebRoot, "playerFallback.js"), contentType: "text/javascript; charset=utf-8" },
};

async function serveWebAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const asset = WEB_ASSETS[pathname];
  if (!asset) return false;

  try {
    const body = await readFile(asset.path);
    response.statusCode = 200;
    response.setHeader("content-type", asset.contentType);
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.end(body);
  } catch {
    writeJson(response, 500, { code: "POC_WEB_ASSET_UNAVAILABLE" });
  }
  return true;
}

function mapResolveError(error: unknown): {
  statusCode: number;
  body: Extract<ResolveResponse, { kind: "error" }>;
} {
  if (error instanceof YouTubeClientError) {
    if (error.code === "MISCONFIGURED") {
      return {
        statusCode: 503,
        body: {
          kind: "error",
          code: "MISCONFIGURED",
          message: "YOUTUBE_API_KEY_REQUIRED",
        },
      };
    }
    if (error.code === "INVALID_INPUT") {
      return {
        statusCode: 400,
        body: {
          kind: "error",
          code: "INVALID_TRACK_REQUEST",
          message: "INVALID_YOUTUBE_REQUEST",
          errors: [error.message],
        },
      };
    }
  }

  return {
    statusCode: 502,
    body: {
      kind: "error",
      code: "TEMPORARILY_UNAVAILABLE",
      message: "YOUTUBE_UPSTREAM_UNAVAILABLE",
    },
  };
}

export function createPocServer(
  config: YouTubePocConfig = loadPocConfig(),
  dependencies: PocServerDependencies = {},
) {
  const client = dependencies.client ?? new YouTubeDataApiClient(config);
  const matcher = dependencies.matcher ?? new TrackMatcher({ regionCode: config.regionCode });
  const coordinator = dependencies.coordinator ?? new RuntimeCandidateCoordinator();

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === `${POC_API_PREFIX}/health`) {
      writeJson(response, 200, healthPayload(config));
      return;
    }

    if (request.method === "GET" && (await serveWebAsset(url.pathname, response))) {
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `${POC_API_PREFIX}/resolve`
    ) {
      try {
        const body = await readJson(request);
        const validationErrors = getResolveRequestErrors(body);
        if (validationErrors.length > 0) {
          const invalidResponse: ResolveResponse = {
            kind: "error",
            code: "INVALID_TRACK_REQUEST",
            message: "TRACK_IDENTITY_INVALID",
            errors: validationErrors,
          };
          writeJson(response, 400, invalidResponse);
          return;
        }

        try {
          const result = await resolveTrack(
            asResolveRequest(body),
            config,
            client,
            matcher,
            coordinator,
          );
          writeJson(response, 200, result);
        } catch (error) {
          const mapped = mapResolveError(error);
          writeJson(response, mapped.statusCode, mapped.body);
        }
      } catch (error) {
        const invalidResponse: ResolveResponse = {
          kind: "error",
          code: "INVALID_TRACK_REQUEST",
          message: "INVALID_REQUEST",
          errors: [error instanceof Error ? error.message : "INVALID_REQUEST"],
        };
        writeJson(response, 400, invalidResponse);
      }
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `${POC_API_PREFIX}/runtime-failure`
    ) {
      try {
        const body = await readJson(request);
        const runtimeFailure = asRuntimeFailureRequest(body);
        if (!runtimeFailure) {
          const invalidResponse: RuntimeFailureResponse = {
            kind: "error",
            code: "INVALID_RUNTIME_FAILURE",
            message: "RUNTIME_FAILURE_REQUEST_INVALID",
          };
          writeJson(response, 400, invalidResponse);
          return;
        }

        const result = coordinator.reportFailure(runtimeFailure);
        const statusCode =
          result.kind !== "error"
            ? 200
            : result.code === "RESOLUTION_NOT_FOUND"
              ? 404
              : result.code === "STALE_CANDIDATE"
                ? 409
                : 400;
        writeJson(response, statusCode, result);
      } catch {
        const invalidResponse: RuntimeFailureResponse = {
          kind: "error",
          code: "INVALID_RUNTIME_FAILURE",
          message: "RUNTIME_FAILURE_REQUEST_INVALID",
        };
        writeJson(response, 400, invalidResponse);
      }
      return;
    }

    writeJson(response, 404, { code: "POC_ROUTE_NOT_FOUND" });
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const port = Number.parseInt(process.env.YOUTUBE_POC_PORT ?? "4178", 10);
  const server = createPocServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `[youtube-fallback-poc] listening on http://127.0.0.1:${port}${POC_API_PREFIX}/health`,
    );
  });
}
