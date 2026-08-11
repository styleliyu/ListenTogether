export type OriginProvider =
  | "netease"
  | "tencent"
  | "kugou"
  | "kuwo"
  | "baidu"
  | "local"
  | "unknown";

export interface TrackIdentity {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  origin: {
    provider: OriginProvider;
    resourceId: string;
  };
}

export interface YouTubeSearchHit {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt?: string;
  searchRank: number;
}

export interface YouTubeSearchInput {
  title: string;
  artists: string[];
}

export interface YouTubeVideoDetails extends YouTubeSearchHit {
  durationMs: number;
  embeddable: boolean;
  madeForKids?: boolean;
  privacyStatus?: string;
  regionRestriction?: {
    allowed?: string[];
    blocked?: string[];
  };
}

export interface RejectedCandidate {
  videoId: string;
  reasons: string[];
}

export type TrackMatchResult =
  | {
      kind: "matched";
      candidate: YouTubeVideoDetails;
      reasons: string[];
    }
  | {
      kind: "unmatched";
      code:
        | "NO_CANDIDATES"
        | "NO_TITLE_MATCH"
        | "NO_ARTIST_MATCH"
        | "DURATION_MISMATCH"
        | "VERSION_CONFLICT"
        | "REGION_BLOCKED"
        | "NOT_EMBEDDABLE"
        | "MADE_FOR_KIDS_EXCLUDED"
        | "RUNTIME_FAILURE_CACHE"
        | "AMBIGUOUS_MATCH";
      rejected: RejectedCandidate[];
    };

export interface YouTubePocConfig {
  apiKey?: string;
  regionCode: string;
  relevanceLanguage: string;
  maxResults: 10;
  requestTimeoutMs: number;
}

export interface YouTubeClient {
  searchVideos(input: YouTubeSearchInput): Promise<YouTubeSearchHit[]>;
  listVideos(videoIds: string[]): Promise<YouTubeVideoDetails[]>;
}

export interface ResolveRequest {
  track: TrackIdentity;
}

export interface ResolveSearchSummary {
  query: string;
  searchCount: number;
  candidateCount: number;
  missingVideoIds: string[];
}

export interface ResolveCandidateView {
  candidate: YouTubeVideoDetails;
  decision: "selected" | "eligible" | "rejected";
  reasons: string[];
}

export type RuntimeSourceErrorCode = 100 | 101 | 150;

export interface RuntimeFailureRequest {
  resolutionId: string;
  videoId: string;
  errorCode: RuntimeSourceErrorCode;
}

export type RuntimeFailureResponse =
  | {
      kind: "switched";
      resolutionId: string;
      failedVideoId: string;
      errorCode: RuntimeSourceErrorCode;
      candidate: YouTubeVideoDetails;
      reasons: string[];
    }
  | {
      kind: "exhausted";
      resolutionId: string;
      failedVideoId: string;
      errorCode: RuntimeSourceErrorCode;
    }
  | {
      kind: "error";
      code: "INVALID_RUNTIME_FAILURE" | "RESOLUTION_NOT_FOUND" | "STALE_CANDIDATE";
      message: string;
    };

export type ResolveNoMatchCode =
  | "NO_SEARCH_RESULTS"
  | "NO_VIDEO_DETAILS"
  | Extract<TrackMatchResult, { kind: "unmatched" }>['code'];

export type ResolveResponse =
  | {
      kind: "matched";
      resolutionId: string;
      candidate: YouTubeVideoDetails;
      reasons: string[];
      candidates: ResolveCandidateView[];
      search: ResolveSearchSummary;
    }
  | {
      kind: "no_match";
      code: ResolveNoMatchCode;
      rejected: RejectedCandidate[];
      candidates: ResolveCandidateView[];
      search: ResolveSearchSummary;
    }
  | {
      kind: "error";
      code:
        | "INVALID_TRACK_REQUEST"
        | "MISCONFIGURED"
        | "TEMPORARILY_UNAVAILABLE";
      message: string;
      errors?: string[];
    };
