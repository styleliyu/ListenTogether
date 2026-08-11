import type {
  RejectedCandidate,
  TrackIdentity,
  TrackMatchResult,
  YouTubeVideoDetails,
} from "./types.js";

export type VersionToken =
  | "live"
  | "concert"
  | "cover"
  | "remix"
  | "instrumental"
  | "karaoke"
  | "acoustic"
  | "demo"
  | "sped up"
  | "slowed"
  | "nightcore"
  | "reaction"
  | "performance"
  | "remaster"
  | "taylor's version"
  | "radio edit"
  | "extended"
  | "re-recorded"
  | "伴奏"
  | "翻唱"
  | "现场"
  | "演唱会"
  | "重制"
  | "重录"
  | "加速"
  | "慢速";

const TRADITIONAL_TO_SIMPLIFIED: Readonly<Record<string, string>> = {
  傑: "杰",
  倫: "伦",
  體: "体",
  員: "员",
  鄧: "邓",
  謙: "谦",
  純: "纯",
  詞: "词",
};

export interface NormalizedTitle {
  text: string;
  core: string;
  versionTokens: Set<VersionToken>;
  isShort: boolean;
}

export interface TrackMatcherOptions {
  regionCode?: string;
}

const STANDARD_DURATION_TOLERANCE_MS = 15_000;
const OFFICIAL_MV_MAX_OVERRUN_MS = 60_000;

const VERSION_PATTERNS: ReadonlyArray<{
  token: VersionToken;
  pattern: RegExp;
  phrase: string;
}> = [
  { token: "taylor's version", pattern: /(?:^|[^a-z0-9])taylor'?s\s+version(?:$|[^a-z0-9])/u, phrase: "taylor's version" },
  { token: "radio edit", pattern: /(?:^|[^a-z0-9])radio\s+edit(?:$|[^a-z0-9])/u, phrase: "radio edit" },
  { token: "sped up", pattern: /(?:^|[^a-z0-9])sped\s+up(?:$|[^a-z0-9])/u, phrase: "sped up" },
  { token: "re-recorded", pattern: /(?:^|[^a-z0-9])re[- ]?record(?:ed)?(?:$|[^a-z0-9])/u, phrase: "re-recorded" },
  { token: "remaster", pattern: /(?:^|[^a-z0-9])remaster(?:ed)?(?:$|[^a-z0-9])/u, phrase: "remaster" },
  { token: "live", pattern: /(?:^|[^a-z0-9])live(?:$|[^a-z0-9])/u, phrase: "live" },
  { token: "concert", pattern: /(?:^|[^a-z0-9])concert(?:$|[^a-z0-9])/u, phrase: "concert" },
  { token: "cover", pattern: /(?:^|[^a-z0-9])cover(?:$|[^a-z0-9])/u, phrase: "cover" },
  { token: "remix", pattern: /(?:^|[^a-z0-9])remix(?:$|[^a-z0-9])/u, phrase: "remix" },
  { token: "instrumental", pattern: /(?:^|[^a-z0-9])instrumental(?:$|[^a-z0-9])/u, phrase: "instrumental" },
  { token: "karaoke", pattern: /(?:^|[^a-z0-9])karaoke(?:$|[^a-z0-9])/u, phrase: "karaoke" },
  { token: "acoustic", pattern: /(?:^|[^a-z0-9])acoustic(?:$|[^a-z0-9])/u, phrase: "acoustic" },
  { token: "demo", pattern: /(?:^|[^a-z0-9])demo(?:$|[^a-z0-9])/u, phrase: "demo" },
  { token: "slowed", pattern: /(?:^|[^a-z0-9])slowed(?:$|[^a-z0-9])/u, phrase: "slowed" },
  { token: "nightcore", pattern: /(?:^|[^a-z0-9])nightcore(?:$|[^a-z0-9])/u, phrase: "nightcore" },
  { token: "reaction", pattern: /(?:^|[^a-z0-9])reaction(?:$|[^a-z0-9])/u, phrase: "reaction" },
  { token: "performance", pattern: /(?:^|[^a-z0-9])performance(?:$|[^a-z0-9])/u, phrase: "performance" },
  { token: "extended", pattern: /(?:^|[^a-z0-9])extended(?:$|[^a-z0-9])/u, phrase: "extended" },
  { token: "伴奏", pattern: /伴奏/u, phrase: "伴奏" },
  { token: "翻唱", pattern: /翻唱/u, phrase: "翻唱" },
  { token: "现场", pattern: /现场/u, phrase: "现场" },
  { token: "演唱会", pattern: /演唱会/u, phrase: "演唱会" },
  { token: "重制", pattern: /重制/u, phrase: "重制" },
  { token: "重录", pattern: /重录/u, phrase: "重录" },
  { token: "加速", pattern: /加速/u, phrase: "加速" },
  { token: "慢速", pattern: /慢速/u, phrase: "慢速" },
  { token: "performance", pattern: /纯享|再唱/u, phrase: "纯享/再唱" },
];

const DECORATION_PATTERNS = [
  /\bofficial\s+(?:music\s+)?video\b/gu,
  /\bofficial\s+audio\b/gu,
  /\bofficial\s+lyrics\b/gu,
  /\blyrics\s+video\b/gu,
  /\bofficial\b/gu,
  /\b(?:audio|lyrics)\b/gu,
];

/** Validate the identity before it enters matching. */
export function validateTrackIdentity(track: TrackIdentity): string[] {
  const errors: string[] = [];

  if (!track || typeof track.title !== "string" || !track.title.trim()) {
    errors.push("TITLE_REQUIRED");
  }
  if (
    !track ||
    !Array.isArray(track.artists) ||
    !track.artists.some((artist) => typeof artist === "string" && artist.trim())
  ) {
    errors.push("ARTIST_REQUIRED");
  }
  if (
    track?.durationMs !== undefined &&
    (!Number.isInteger(track.durationMs) || track.durationMs <= 0)
  ) {
    errors.push("DURATION_INVALID");
  }
  if (
    !track ||
    !track.origin ||
    typeof track.origin.resourceId !== "string" ||
    !track.origin.resourceId.trim()
  ) {
    errors.push("ORIGIN_RESOURCE_ID_REQUIRED");
  }

  return errors;
}

/** Normalize HTML entities without adding a runtime dependency to the POC. */
export function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
    nbsp: " ",
  };

  return input.replace(/&(#x[\da-f]+|#\d+|[a-z]+);?/giu, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return isValidUnicodeCodePoint(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return isValidUnicodeCodePoint(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return named[lower] ?? whole;
  });
}

function isValidUnicodeCodePoint(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff)
  );
}

/** Apply the design-document normalization rules while keeping version words. */
export function normalizeText(input: string): string {
  return decodeHtmlEntities(String(input))
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[傑倫體員鄧謙純詞]/gu, (character) => TRADITIONAL_TO_SIMPLIFIED[character] ?? character)
    .replace(/[’‘‛′]/gu, "'")
    .replace(/[“”„‟″]/gu, '"')
    .replace(/[‐‑‒–—―−]/gu, " - ")
    .replace(/[·•]/gu, " ")
    .replace(/[()[\]{}【】《》〈〉「」『』]/gu, " ")
    .replace(/[,:;!?！？。，、…/\\|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function extractVersionTokens(input: string): Set<VersionToken> {
  const normalized = normalizeText(input);
  const result = new Set<VersionToken>();
  for (const entry of VERSION_PATTERNS) {
    if (entry.pattern.test(normalized)) result.add(entry.token);
    entry.pattern.lastIndex = 0;
  }
  return result;
}

export function normalizeTitle(input: string): NormalizedTitle {
  const text = normalizeText(input);
  const versionTokens = extractVersionTokens(text);
  let core = text;

  for (const entry of VERSION_PATTERNS) {
    core = core.replace(entry.pattern, " ");
  }
  for (const pattern of DECORATION_PATTERNS) {
    core = core.replace(pattern, " ");
  }

  core = core
    .replace(/\s*-\s*$/u, "")
    .replace(/^\s*-\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();

  return {
    text,
    core,
    versionTokens,
    isShort: countTitleCharacters(core) <= 2,
  };
}

export function normalizeArtist(input: string): string {
  return normalizeText(input)
    .replace(/\b(?:feat\.?|ft\.?|featuring)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Match and rank candidates without network access or non-deterministic data. */
export function matchTrack(
  track: TrackIdentity,
  candidates: readonly YouTubeVideoDetails[],
  options: TrackMatcherOptions = {},
): TrackMatchResult {
  const validationErrors = validateTrackIdentity(track);
  if (validationErrors.length > 0 || candidates.length === 0) {
    return {
      kind: "unmatched",
      code: candidates.length === 0 ? "NO_CANDIDATES" : "NO_TITLE_MATCH",
      rejected: [],
    };
  }

  const regionCode = (options.regionCode ?? "HK").trim().toUpperCase() || "HK";
  const targetTitle = normalizeTitle(track.title);
  const targetArtists = track.artists.map(normalizeArtist).filter(Boolean);
  const targetVersions = targetTitle.versionTokens;
  const rejected: RejectedCandidate[] = [];
  const accepted: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const reasons: string[] = [];
    const candidateTitle = normalizeTitle(candidate.title);
    const candidateText = normalizeText(candidate.title);
    const channelText = normalizeText(candidate.channelTitle);
    const titleExact = isExactTitle(candidateTitle.core, targetTitle.core);
    const titleContains = containsNormalized(candidateTitle.core, targetTitle.core);
    const shortTitleSafe =
      titleExact || containsAtTextBoundary(candidateTitle.core, targetTitle.core);
    const primaryArtistMatch = targetArtists[0]
      ? containsNormalized(candidateText, targetArtists[0]) ||
        containsNormalized(channelText, targetArtists[0])
      : false;
    const matchedArtistCount = targetArtists.filter(
      (artist) => containsNormalized(candidateText, artist) || containsNormalized(channelText, artist),
    ).length;
    const channelArtistMatch = containsNormalized(channelText, targetArtists[0] ?? "");
    const trustedOfficialAudio = channelArtistMatch && hasOfficialAudioLabel(candidateTitle.text);
    const artistTopicChannel = channelArtistMatch && isTopicChannel(channelText);
    const trustedOfficialMusicVideo =
      channelArtistMatch && hasOfficialMusicVideoLabel(candidateTitle.text);
    const officialSourcePriority =
      trustedOfficialAudio || artistTopicChannel ? 2 : trustedOfficialMusicVideo ? 1 : 0;
    const durationDelta =
      track.durationMs === undefined ? undefined : candidate.durationMs - track.durationMs;
    const durationDiff = durationDelta === undefined ? undefined : Math.abs(durationDelta);
    const durationWithinLimit =
      durationDelta === undefined ||
      (trustedOfficialMusicVideo
        ? durationDelta >= -STANDARD_DURATION_TOLERANCE_MS &&
          durationDelta <= OFFICIAL_MV_MAX_OVERRUN_MS
        : Math.abs(durationDelta) <= STANDARD_DURATION_TOLERANCE_MS);
    const versionConflict = hasVersionConflict(targetVersions, candidateTitle.versionTokens);

    if (candidate.embeddable !== true) reasons.push("NOT_EMBEDDABLE");
    if (candidate.madeForKids === true) reasons.push("MADE_FOR_KIDS_EXCLUDED");
    if (isRegionBlocked(candidate.regionRestriction, regionCode)) reasons.push("REGION_BLOCKED");
    if (!Number.isFinite(candidate.durationMs) || candidate.durationMs <= 0) {
      reasons.push("DURATION_MISMATCH");
    } else if (!durationWithinLimit) {
      reasons.push("DURATION_MISMATCH");
    }
    if (versionConflict) reasons.push("VERSION_CONFLICT");
    if (!titleContains || (targetTitle.isShort && !shortTitleSafe)) reasons.push("NO_TITLE_MATCH");
    if (!primaryArtistMatch) reasons.push("NO_ARTIST_MATCH");

    if (reasons.length > 0) {
      rejected.push({ videoId: candidate.videoId, reasons });
      continue;
    }

    const score: ScoredCandidate = {
      candidate,
      titleExact,
      matchedArtistCount,
      channelArtistMatch,
      officialSourcePriority,
      durationDiff: durationDiff ?? 0,
      officialLabel: hasOfficialLabel(candidateTitle.text),
      searchRank: Number.isFinite(candidate.searchRank) ? candidate.searchRank : Number.MAX_SAFE_INTEGER,
      reasons: [
        titleExact ? "TITLE_EXACT" : "TITLE_CONTAINS",
        `ARTIST_MATCH_${matchedArtistCount}`,
        trustedOfficialMusicVideo
          ? "OFFICIAL_MV_DURATION_TOLERANCE"
          : "DURATION_WITHIN_15S",
        ...(channelArtistMatch ? ["CHANNEL_ARTIST_MATCH"] : []),
        ...(hasOfficialLabel(candidateTitle.text) ? ["OFFICIAL_METADATA"] : []),
        ...(trustedOfficialAudio ? ["OFFICIAL_AUDIO_CHANNEL_ARTIST_HEURISTIC"] : []),
        ...(artistTopicChannel ? ["ARTIST_TOPIC_CHANNEL"] : []),
        ...(trustedOfficialMusicVideo ? ["OFFICIAL_MV_CHANNEL_ARTIST_HEURISTIC"] : []),
        ...(track.durationMs === undefined ? ["DURATION_MISSING_EXACT_IDENTITY"] : []),
      ],
    };
    accepted.push(score);
  }

  if (accepted.length === 0) {
    return {
      kind: "unmatched",
      code: chooseUnmatchedCode(rejected),
      rejected,
    };
  }

  accepted.sort(compareCandidates);
  if (accepted.length > 1 && sameSemanticScore(accepted[0], accepted[1])) {
    return {
      kind: "unmatched",
      code: "AMBIGUOUS_MATCH",
      rejected: [
        ...rejected,
        ...accepted.map(({ candidate }) => ({
          videoId: candidate.videoId,
          reasons: ["AMBIGUOUS_MATCH"],
        })),
      ],
    };
  }

  return {
    kind: "matched",
    candidate: accepted[0].candidate,
    reasons: accepted[0].reasons,
  };
}

/** Class form kept for the production resolver migration planned after POC. */
export class TrackMatcher {
  constructor(private readonly options: TrackMatcherOptions = {}) {}

  match(track: TrackIdentity, candidates: readonly YouTubeVideoDetails[]): TrackMatchResult {
    return matchTrack(track, candidates, this.options);
  }
}

interface ScoredCandidate {
  candidate: YouTubeVideoDetails;
  titleExact: boolean;
  matchedArtistCount: number;
  channelArtistMatch: boolean;
  officialSourcePriority: number;
  durationDiff: number;
  officialLabel: boolean;
  searchRank: number;
  reasons: string[];
}

function countTitleCharacters(value: string): number {
  return [...value.replace(/[\s-]/gu, "")].length;
}

function isExactTitle(candidateCore: string, targetCore: string): boolean {
  if (candidateCore === targetCore) return true;
  return splitTitleParts(candidateCore).some((part) => part === targetCore);
}

function splitTitleParts(value: string): string[] {
  return value
    .split(/\s+-\s+|\s+\|\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function containsNormalized(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  if (/[^a-z0-9\s]/u.test(needle)) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "u").test(haystack);
}

function containsAtTextBoundary(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) return false;
    const before = index === 0 ? "" : haystack[index - 1];
    const afterIndex = index + needle.length;
    const after = afterIndex >= haystack.length ? "" : haystack[afterIndex];
    const isWordCharacter = (character: string) => /[\p{L}\p{N}]/u.test(character);
    if ((!before || !isWordCharacter(before)) && (!after || !isWordCharacter(after))) {
      return true;
    }
    offset = index + 1;
  }
  return false;
}

function hasVersionConflict(
  target: ReadonlySet<VersionToken>,
  candidate: ReadonlySet<VersionToken>,
): boolean {
  if (target.size === 0) return candidate.size > 0;
  if (candidate.size === 0) return true;
  if ([...target].some((token) => !candidate.has(token))) return true;
  return [...candidate].some((token) => !target.has(token));
}

function isRegionBlocked(
  restriction: YouTubeVideoDetails["regionRestriction"],
  regionCode: string,
): boolean {
  if (!restriction) return false;
  const allowed = restriction.allowed?.map((code) => code.toUpperCase());
  const blocked = restriction.blocked?.map((code) => code.toUpperCase());
  if (blocked?.includes(regionCode)) return true;
  return Boolean(allowed && !allowed.includes(regionCode));
}

function hasOfficialLabel(title: string): boolean {
  return /\bofficial(?:\s+(?:music\s+)?video|\s+audio|\s+lyrics)\b/u.test(title);
}

function hasOfficialMusicVideoLabel(title: string): boolean {
  return /\bofficial\s+(?:music\s+)?video\b/u.test(title);
}

function hasOfficialAudioLabel(title: string): boolean {
  return /\bofficial\s+audio\b/u.test(title);
}

function isTopicChannel(channel: string): boolean {
  return /(?:^|[\s-])topic$/u.test(channel);
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.titleExact !== right.titleExact) return left.titleExact ? -1 : 1;
  if (left.matchedArtistCount !== right.matchedArtistCount) {
    return right.matchedArtistCount - left.matchedArtistCount;
  }
  if (left.officialSourcePriority !== right.officialSourcePriority) {
    return right.officialSourcePriority - left.officialSourcePriority;
  }
  if (left.channelArtistMatch !== right.channelArtistMatch) return left.channelArtistMatch ? -1 : 1;
  if (left.durationDiff !== right.durationDiff) return left.durationDiff - right.durationDiff;
  if (left.officialLabel !== right.officialLabel) return left.officialLabel ? -1 : 1;
  if (left.searchRank !== right.searchRank) return left.searchRank - right.searchRank;
  return left.candidate.videoId.localeCompare(right.candidate.videoId);
}

function sameSemanticScore(left: ScoredCandidate, right: ScoredCandidate): boolean {
  return (
    left.titleExact === right.titleExact &&
    left.matchedArtistCount === right.matchedArtistCount &&
    left.officialSourcePriority === right.officialSourcePriority &&
    left.channelArtistMatch === right.channelArtistMatch &&
    left.durationDiff === right.durationDiff &&
    left.officialLabel === right.officialLabel
  );
}

function chooseUnmatchedCode(
  rejected: readonly RejectedCandidate[],
): Extract<TrackMatchResult, { kind: "unmatched" }>["code"] {
  if (rejected.length === 0) return "NO_CANDIDATES";
  const priority: Extract<TrackMatchResult, { kind: "unmatched" }>["code"][] = [
    "NO_TITLE_MATCH",
    "NO_ARTIST_MATCH",
    "VERSION_CONFLICT",
    "DURATION_MISMATCH",
    "REGION_BLOCKED",
    "NOT_EMBEDDABLE",
    "MADE_FOR_KIDS_EXCLUDED",
  ];
  const counts = new Map<string, number>();
  for (const item of rejected) {
    for (const reason of item.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return priority.reduce((best, code) => {
    const bestCount = counts.get(best) ?? 0;
    const nextCount = counts.get(code) ?? 0;
    return nextCount > bestCount ? code : best;
  }, priority[0]);
}
