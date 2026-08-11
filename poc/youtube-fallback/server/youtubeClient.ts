import type {
  YouTubeClient,
  YouTubePocConfig,
  YouTubeSearchHit,
  YouTubeSearchInput,
  YouTubeVideoDetails,
} from "./types.js";

export const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";

export type YouTubeClientErrorCode =
  | "MISCONFIGURED"
  | "INVALID_INPUT"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "SCHEMA_INVALID";

export class YouTubeClientError extends Error {
  constructor(
    public readonly code: YouTubeClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeClientError";
  }
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export interface YouTubeClientOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export function loadPocConfig(
  env: NodeJS.ProcessEnv = process.env,
): YouTubePocConfig {
  const regionCode = (env.YOUTUBE_REGION_CODE ?? "HK").trim().toUpperCase();
  const relevanceLanguage = (env.YOUTUBE_RELEVANCE_LANGUAGE ?? "zh-Hans").trim();

  return {
    apiKey: env.YOUTUBE_API_KEY?.trim() || undefined,
    regionCode: regionCode || "HK",
    relevanceLanguage: relevanceLanguage || "zh-Hans",
    maxResults: 10,
    requestTimeoutMs: 5000,
  };
}

export function isPocConfigured(config: YouTubePocConfig): boolean {
  return Boolean(config.apiKey);
}

/**
 * Keep the query deliberately boring: version tokens already present in the
 * source title are preserved, while only unsafe whitespace is collapsed.
 */
export function buildSearchQuery(input: YouTubeSearchInput): string {
  const title = input.title.trim().replace(/\s+/gu, " ");
  const artists = input.artists
    .map((artist) => artist.trim().replace(/\s+/gu, " "))
    .filter(Boolean);

  if (!title) {
    throw new YouTubeClientError("INVALID_INPUT", "TITLE_REQUIRED");
  }
  if (artists.length === 0) {
    throw new YouTubeClientError("INVALID_INPUT", "ARTIST_REQUIRED");
  }

  return [title, ...artists].join(" ");
}

/**
 * YouTube duration values use the ISO 8601 duration form. The parser walks
 * the ordered date/time components instead of assuming only minutes/seconds.
 */
export function parseIso8601DurationMs(value: string): number {
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("P")) {
    throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
  }

  let cursor = 1;
  let inTime = false;
  let lastUnitIndex = -1;
  let sawComponent = false;
  let totalMilliseconds = 0;
  const units = ["D", "H", "M", "S"] as const;
  const multipliers = [86_400_000, 3_600_000, 60_000, 1_000] as const;

  while (cursor < value.length) {
    if (value[cursor] === "T") {
      if (inTime || cursor === value.length - 1) {
        throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
      }
      inTime = true;
      lastUnitIndex = 0;
      cursor += 1;
      continue;
    }

    const numberStart = cursor;
    let hasDecimal = false;
    while (cursor < value.length) {
      const char = value[cursor];
      if (char >= "0" && char <= "9") {
        cursor += 1;
        continue;
      }
      if (char === "." && !hasDecimal) {
        hasDecimal = true;
        cursor += 1;
        continue;
      }
      break;
    }

    if (cursor === numberStart || cursor >= value.length) {
      throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
    }

    const amount = Number(value.slice(numberStart, cursor));
    if (!Number.isFinite(amount) || amount < 0) {
      throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
    }

    const unit = value[cursor] as (typeof units)[number];
    const unitIndex = units.indexOf(unit);
    if (unitIndex < 0 || (!inTime && unitIndex !== 0) || unitIndex <= lastUnitIndex) {
      throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
    }

    // ISO 8601 permits a fractional value only on the smallest component.
    if (hasDecimal && cursor + 1 < value.length) {
      const rest = value.slice(cursor + 1);
      if (rest.match(/[DHMS]/u)) {
        throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
      }
    }

    totalMilliseconds += amount * multipliers[unitIndex];
    if (!Number.isSafeInteger(Math.round(totalMilliseconds))) {
      throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
    }

    sawComponent = true;
    lastUnitIndex = unitIndex;
    cursor += 1;
  }

  if (!sawComponent) {
    throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_ISO8601_DURATION");
  }

  return Math.round(totalMilliseconds);
}

export function isYouTubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/u.test(value);
}

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export class YouTubeDataApiClient implements YouTubeClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(
    private readonly config: YouTubePocConfig,
    options: YouTubeClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.baseUrl = (options.baseUrl ?? YOUTUBE_API_BASE_URL).replace(/\/+$/u, "");
  }

  async searchVideos(input: YouTubeSearchInput): Promise<YouTubeSearchHit[]> {
    const query = buildSearchQuery(input);
    const response = await this.requestJson("search", {
      part: "snippet",
      type: "video",
      q: query,
      maxResults: String(this.config.maxResults),
      videoEmbeddable: "true",
      videoSyndicated: "true",
      safeSearch: "moderate",
      regionCode: this.config.regionCode,
      relevanceLanguage: this.config.relevanceLanguage,
    });

    return parseSearchResponse(response);
  }

  async listVideos(videoIds: string[]): Promise<YouTubeVideoDetails[]> {
    const uniqueIds = [...new Set(videoIds)];
    if (uniqueIds.length === 0) return [];
    if (uniqueIds.length > this.config.maxResults) {
      throw new YouTubeClientError("INVALID_INPUT", "TOO_MANY_VIDEO_IDS");
    }
    if (uniqueIds.some((videoId) => !isYouTubeVideoId(videoId))) {
      throw new YouTubeClientError("INVALID_INPUT", "INVALID_VIDEO_ID");
    }

    const response = await this.requestJson("videos", {
      part: "snippet,contentDetails,status",
      id: uniqueIds.join(","),
    });
    return parseVideoResponse(response, uniqueIds);
  }

  private async requestJson(
    resource: "search" | "videos",
    params: Record<string, string>,
  ): Promise<unknown> {
    if (!this.config.apiKey) {
      throw new YouTubeClientError("MISCONFIGURED", "YOUTUBE_API_KEY_REQUIRED");
    }

    const url = new URL(`${this.baseUrl}/${resource}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    // The key is intentionally added only at the last server-side boundary.
    url.searchParams.set("key", this.config.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        throw new YouTubeClientError("HTTP_ERROR", `YOUTUBE_HTTP_${response.status}`);
      }

      try {
        return await response.json();
      } catch {
        throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_JSON_RESPONSE");
      }
    } catch (error) {
      if (error instanceof YouTubeClientError) throw error;
      if (controller.signal.aborted) {
        throw new YouTubeClientError("TIMEOUT", "YOUTUBE_REQUEST_TIMEOUT");
      }
      throw new YouTubeClientError("HTTP_ERROR", "YOUTUBE_REQUEST_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseSearchResponse(value: unknown): YouTubeSearchHit[] {
  const root = asRecord(value, "SEARCH_RESPONSE_OBJECT");
  const items = asArray(root.items, "SEARCH_ITEMS_ARRAY");
  const seen = new Set<string>();
  const result: YouTubeSearchHit[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = asRecord(items[index], "SEARCH_ITEM_OBJECT");
    const id = asRecord(item.id, "SEARCH_ITEM_ID_OBJECT");
    const snippet = asRecord(item.snippet, "SEARCH_ITEM_SNIPPET_OBJECT");
    const videoId = asNonEmptyString(id.videoId, "SEARCH_VIDEO_ID");
    if (seen.has(videoId)) continue;
    if (!isYouTubeVideoId(videoId)) {
      throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_SEARCH_VIDEO_ID");
    }

    result.push({
      videoId,
      title: asNonEmptyString(snippet.title, "SEARCH_TITLE"),
      channelTitle: asNonEmptyString(snippet.channelTitle, "SEARCH_CHANNEL_TITLE"),
      publishedAt: optionalString(snippet.publishedAt, "SEARCH_PUBLISHED_AT"),
      searchRank: index,
    });
    seen.add(videoId);
  }

  return result;
}

function parseVideoResponse(
  value: unknown,
  requestedIds: string[],
): YouTubeVideoDetails[] {
  const root = asRecord(value, "VIDEOS_RESPONSE_OBJECT");
  const items = asArray(root.items, "VIDEOS_ITEMS_ARRAY");
  const searchRank = new Map(requestedIds.map((videoId, index) => [videoId, index]));
  const parsed = new Map<string, YouTubeVideoDetails>();

  for (const rawItem of items) {
    const item = asRecord(rawItem, "VIDEOS_ITEM_OBJECT");
    const videoId = asNonEmptyString(item.id, "VIDEOS_VIDEO_ID");
    if (!isYouTubeVideoId(videoId)) {
      throw new YouTubeClientError("SCHEMA_INVALID", "INVALID_VIDEO_ID");
    }
    const snippet = asRecord(item.snippet, "VIDEOS_SNIPPET_OBJECT");
    const contentDetails = asRecord(item.contentDetails, "VIDEOS_CONTENT_DETAILS_OBJECT");
    const status = asRecord(item.status, "VIDEOS_STATUS_OBJECT");
    const regionRestriction = parseRegionRestriction(contentDetails.regionRestriction);

    parsed.set(videoId, {
      videoId,
      title: asNonEmptyString(snippet.title, "VIDEOS_TITLE"),
      channelTitle: asNonEmptyString(snippet.channelTitle, "VIDEOS_CHANNEL_TITLE"),
      publishedAt: optionalString(snippet.publishedAt, "VIDEOS_PUBLISHED_AT"),
      searchRank: searchRank.get(videoId) ?? requestedIds.length,
      durationMs: parseIso8601DurationMs(
        asNonEmptyString(contentDetails.duration, "VIDEOS_DURATION"),
      ),
      embeddable: asBoolean(status.embeddable, "VIDEOS_EMBEDDABLE"),
      madeForKids: optionalBoolean(status.madeForKids, "VIDEOS_MADE_FOR_KIDS"),
      privacyStatus: optionalString(status.privacyStatus, "VIDEOS_PRIVACY_STATUS"),
      regionRestriction,
    });
  }

  // API omissions (deleted/private/unavailable videos) remain absent and are
  // deliberately not replaced with guessed metadata.
  return requestedIds
    .map((videoId) => parsed.get(videoId))
    .filter((candidate): candidate is YouTubeVideoDetails => candidate !== undefined);
}

function parseRegionRestriction(value: unknown): YouTubeVideoDetails["regionRestriction"] {
  if (value === undefined) return undefined;
  const record = asRecord(value, "VIDEOS_REGION_RESTRICTION_OBJECT");
  return {
    allowed: optionalStringArray(record.allowed, "VIDEOS_REGION_ALLOWED"),
    blocked: optionalStringArray(record.blocked, "VIDEOS_REGION_BLOCKED"),
  };
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new YouTubeClientError("SCHEMA_INVALID", code);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new YouTubeClientError("SCHEMA_INVALID", code);
  }
  return value;
}

function asNonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new YouTubeClientError("SCHEMA_INVALID", code);
  }
  return value;
}

function optionalString(value: unknown, code: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new YouTubeClientError("SCHEMA_INVALID", code);
  }
  return value;
}

function asBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") {
    throw new YouTubeClientError("SCHEMA_INVALID", code);
  }
  return value;
}

function optionalBoolean(value: unknown, code: string): boolean | undefined {
  if (value === undefined) return undefined;
  return asBoolean(value, code);
}

function optionalStringArray(value: unknown, code: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new YouTubeClientError("SCHEMA_INVALID", code);
  }
  return value;
}
