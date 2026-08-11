import { randomUUID } from "node:crypto";
import type {
  ResolveCandidateView,
  RuntimeFailureRequest,
  RuntimeFailureResponse,
  YouTubeVideoDetails,
} from "./types.js";

interface RuntimeResolutionSession {
  queue: ResolveCandidateView[];
  currentIndex: number;
  expiresAt: number;
  regionCode: string;
}

export interface RuntimeCandidateCoordinatorOptions {
  now?: () => number;
  createId?: () => string;
  sessionTtlMs?: number;
  failureTtlMs?: number;
  maxSessions?: number;
}

const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FAILURE_TTL_MS = 24 * 60 * 60 * 1000;

/** POC-only in-memory authority for runtime IFrame failures and candidate switching. */
export class RuntimeCandidateCoordinator {
  private readonly sessions = new Map<string, RuntimeResolutionSession>();
  private readonly failedUntil = new Map<string, number>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly sessionTtlMs: number;
  private readonly failureTtlMs: number;
  private readonly maxSessions: number;

  constructor(options: RuntimeCandidateCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.failureTtlMs = options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
    this.maxSessions = options.maxSessions ?? 100;
  }

  isRuntimeRejected(videoId: string, regionCode: string): boolean {
    this.purgeExpired();
    return (this.failedUntil.get(this.failureKey(videoId, regionCode)) ?? 0) > this.now();
  }

  filterRuntimeRejected(
    candidates: readonly YouTubeVideoDetails[],
    regionCode: string,
  ): YouTubeVideoDetails[] {
    return candidates.filter((candidate) => !this.isRuntimeRejected(candidate.videoId, regionCode));
  }

  createResolution(
    candidateViews: readonly ResolveCandidateView[],
    selectedVideoId: string,
    regionCode: string,
  ): string {
    this.purgeExpired();
    const selected = candidateViews.find(
      (view) => view.decision === "selected" && view.candidate.videoId === selectedVideoId,
    );
    if (!selected) throw new Error("SELECTED_CANDIDATE_MISSING");

    const seen = new Set<string>();
    const eligible = candidateViews
      .filter(
        (view) => view.decision === "eligible" && view.candidate.videoId !== selectedVideoId,
      )
      .sort(compareRuntimeCandidates);
    const queue = [
      selected,
      ...eligible,
    ].filter((view) => {
      if (seen.has(view.candidate.videoId)) return false;
      seen.add(view.candidate.videoId);
      return true;
    });

    while (this.sessions.size >= this.maxSessions) {
      const oldestId = this.sessions.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.sessions.delete(oldestId);
    }

    const resolutionId = this.createId();
    this.sessions.set(resolutionId, {
      queue,
      currentIndex: 0,
      expiresAt: this.now() + this.sessionTtlMs,
      regionCode: this.normalizeRegion(regionCode),
    });
    return resolutionId;
  }

  reportFailure(request: RuntimeFailureRequest): RuntimeFailureResponse {
    this.purgeExpired();
    if (![100, 101, 150].includes(request.errorCode)) {
      return {
        kind: "error",
        code: "INVALID_RUNTIME_FAILURE",
        message: "RUNTIME_ERROR_CODE_UNSUPPORTED",
      };
    }

    const session = this.sessions.get(request.resolutionId);
    if (!session) {
      return {
        kind: "error",
        code: "RESOLUTION_NOT_FOUND",
        message: "RUNTIME_RESOLUTION_EXPIRED_OR_UNKNOWN",
      };
    }

    const current = session.queue[session.currentIndex];
    if (!current || current.candidate.videoId !== request.videoId) {
      return {
        kind: "error",
        code: "STALE_CANDIDATE",
        message: "RUNTIME_FAILURE_DOES_NOT_MATCH_CURRENT_CANDIDATE",
      };
    }

    this.failedUntil.set(
      this.failureKey(request.videoId, session.regionCode),
      this.now() + this.failureTtlMs,
    );

    const nextIndex = session.queue.findIndex(
      (view, index) =>
        index > session.currentIndex &&
        !this.isRuntimeRejected(view.candidate.videoId, session.regionCode),
    );
    if (nextIndex < 0) {
      this.sessions.delete(request.resolutionId);
      return {
        kind: "exhausted",
        resolutionId: request.resolutionId,
        failedVideoId: request.videoId,
        errorCode: request.errorCode,
      };
    }

    session.currentIndex = nextIndex;
    session.expiresAt = this.now() + this.sessionTtlMs;
    const next = session.queue[nextIndex];
    return {
      kind: "switched",
      resolutionId: request.resolutionId,
      failedVideoId: request.videoId,
      errorCode: request.errorCode,
      candidate: next.candidate,
      reasons: next.reasons,
    };
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [resolutionId, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(resolutionId);
    }
    for (const [key, expiresAt] of this.failedUntil) {
      if (expiresAt <= now) this.failedUntil.delete(key);
    }
  }

  private failureKey(videoId: string, regionCode: string): string {
    return `${this.normalizeRegion(regionCode)}:${videoId}`;
  }

  private normalizeRegion(regionCode: string): string {
    return regionCode.trim().toUpperCase() || "HK";
  }
}

function compareRuntimeCandidates(
  left: ResolveCandidateView,
  right: ResolveCandidateView,
): number {
  const leftTitleExact = left.reasons.includes("TITLE_EXACT");
  const rightTitleExact = right.reasons.includes("TITLE_EXACT");
  if (leftTitleExact !== rightTitleExact) return leftTitleExact ? -1 : 1;

  const leftArtists = matchedArtistCount(left.reasons);
  const rightArtists = matchedArtistCount(right.reasons);
  if (leftArtists !== rightArtists) return rightArtists - leftArtists;

  const leftSource = officialSourcePriority(left.reasons);
  const rightSource = officialSourcePriority(right.reasons);
  if (leftSource !== rightSource) return rightSource - leftSource;

  const leftChannel = left.reasons.includes("CHANNEL_ARTIST_MATCH");
  const rightChannel = right.reasons.includes("CHANNEL_ARTIST_MATCH");
  if (leftChannel !== rightChannel) return leftChannel ? -1 : 1;

  if (left.candidate.searchRank !== right.candidate.searchRank) {
    return left.candidate.searchRank - right.candidate.searchRank;
  }
  return left.candidate.videoId.localeCompare(right.candidate.videoId);
}

function matchedArtistCount(reasons: readonly string[]): number {
  const reason = reasons.find((item) => /^ARTIST_MATCH_\d+$/u.test(item));
  return reason ? Number.parseInt(reason.slice("ARTIST_MATCH_".length), 10) : 0;
}

function officialSourcePriority(reasons: readonly string[]): number {
  if (
    reasons.includes("OFFICIAL_AUDIO_CHANNEL_ARTIST_HEURISTIC") ||
    reasons.includes("ARTIST_TOPIC_CHANNEL")
  ) {
    return 2;
  }
  return reasons.includes("OFFICIAL_MV_CHANNEL_ARTIST_HEURISTIC") ? 1 : 0;
}
