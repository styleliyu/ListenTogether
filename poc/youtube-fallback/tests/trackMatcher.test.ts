import assert from "node:assert/strict";
import {
  decodeHtmlEntities,
  extractVersionTokens,
  matchTrack,
  normalizeText,
  normalizeTitle,
  TrackMatcher,
} from "../server/trackMatcher.js";
import type { TrackIdentity, YouTubeVideoDetails } from "../server/types.js";

const baseTrack: TrackIdentity = {
  title: "Love Story",
  artists: ["Taylor Swift"],
  durationMs: 236_000,
  origin: { provider: "tencent", resourceId: "fixture-love-story" },
};

function candidate(
  overrides: Partial<YouTubeVideoDetails> = {},
): YouTubeVideoDetails {
  return {
    videoId: "abcdefghijk",
    title: "Taylor Swift - Love Story (Official Audio)",
    channelTitle: "Taylor Swift",
    searchRank: 0,
    durationMs: 236_000,
    embeddable: true,
    ...overrides,
  };
}

assert.equal(normalizeText("Ａｍｐ； &amp;  \u2014  Test"), "amp & - test");
assert.equal(normalizeText("周杰倫 鄧紫棋 薛之謙 體面 演員"), "周杰伦 邓紫棋 薛之谦 体面 演员");
assert.equal(decodeHtmlEntities("invalid &#999999999; entity"), "invalid &#999999999; entity");
assert.equal(normalizeTitle("Love Story (Official Music Video)").core, "love story");
assert.deepEqual([...extractVersionTokens("Love Story (Taylor’s Version)")], ["taylor's version"]);
assert.deepEqual([...extractVersionTokens("晴天（现场）")], ["现场"]);

const officialResult = matchTrack(baseTrack, [candidate()]);
assert.equal(officialResult.kind, "matched");
if (officialResult.kind === "matched") {
  assert.equal(officialResult.candidate.videoId, "abcdefghijk");
  assert.ok(officialResult.reasons.includes("TITLE_EXACT"));
  assert.ok(officialResult.reasons.includes("OFFICIAL_METADATA"));
}

const versionResult = matchTrack(baseTrack, [
  candidate({ videoId: "bcdefghijkl", title: "Love Story (Taylor's Version)" }),
]);
assert.equal(versionResult.kind, "unmatched");
if (versionResult.kind === "unmatched") assert.equal(versionResult.code, "VERSION_CONFLICT");

const requestedVersion = { ...baseTrack, title: "Love Story (Taylor's Version)" };
const requestedVersionResult = matchTrack(requestedVersion, [
  candidate({ videoId: "cdefghijkl_", title: "Taylor Swift - Love Story (Taylor's Version)" }),
]);
assert.equal(requestedVersionResult.kind, "matched");

const liveVersionResult = matchTrack(requestedVersion, [
  candidate({ videoId: "defghijkl__", title: "Love Story (Taylor's Version) (Live)" }),
]);
assert.equal(liveVersionResult.kind, "unmatched");
if (liveVersionResult.kind === "unmatched") assert.equal(liveVersionResult.code, "VERSION_CONFLICT");

for (const [difference, expected] of [
  [14_999, "matched"],
  [15_000, "matched"],
  [15_001, "unmatched"],
] as const) {
  const result = matchTrack(baseTrack, [
    candidate({ videoId: `dur${String(difference).padStart(8, "0")}`.slice(0, 11), durationMs: 236_000 + difference }),
  ]);
  assert.equal(result.kind, expected, `duration difference ${difference}`);
}

const restricted = matchTrack(baseTrack, [
  candidate({ videoId: "efghijkl___", regionRestriction: { blocked: ["HK"] } }),
]);
assert.equal(restricted.kind, "unmatched");
if (restricted.kind === "unmatched") assert.equal(restricted.code, "REGION_BLOCKED");

const unavailable = matchTrack(baseTrack, [
  candidate({ videoId: "fghijkl____", embeddable: false }),
]);
assert.equal(unavailable.kind, "unmatched");
if (unavailable.kind === "unmatched") assert.equal(unavailable.code, "NOT_EMBEDDABLE");

const childOnly = matchTrack(baseTrack, [
  candidate({ videoId: "ghijkl_____", madeForKids: true }),
]);
assert.equal(childOnly.kind, "unmatched");
if (childOnly.kind === "unmatched") assert.equal(childOnly.code, "MADE_FOR_KIDS_EXCLUDED");

const shortTitle: TrackIdentity = {
  title: "晴天",
  artists: ["周杰伦"],
  durationMs: 269_000,
  origin: { provider: "netease", resourceId: "fixture-sunny" },
};
const unsafeShort = matchTrack(shortTitle, [
  candidate({
    videoId: "hijkl______",
    title: "超级晴天 官方视频",
    channelTitle: "周杰伦",
    durationMs: 269_000,
  }),
]);
assert.equal(unsafeShort.kind, "unmatched");
if (unsafeShort.kind === "unmatched") assert.equal(unsafeShort.code, "NO_TITLE_MATCH");

const structuredShort = matchTrack(shortTitle, [
  candidate({
    videoId: "ijkl_______",
    title: "周杰伦 - 晴天 (Official Audio)",
    channelTitle: "Jay Chou",
    durationMs: 269_000,
  }),
]);
assert.equal(structuredShort.kind, "matched");

const translatedStructuredShort = matchTrack(shortTitle, [
  candidate({
    videoId: "shorttrad01",
    title: "周杰倫 Jay Chou【晴天 Sunny Day】-Official Music Video",
    channelTitle: "周杰倫 Jay Chou",
    durationMs: 269_000,
  }),
]);
assert.equal(translatedStructuredShort.kind, "matched");

const longOfficialMusicVideo = matchTrack(shortTitle, [
  candidate({
    videoId: "officialmv1",
    title: "周杰倫 Jay Chou【晴天 Sunny Day】-Official Music Video",
    channelTitle: "周杰倫 Jay Chou",
    durationMs: 319_000,
  }),
]);
assert.equal(longOfficialMusicVideo.kind, "matched");
if (longOfficialMusicVideo.kind === "matched") {
  assert.ok(longOfficialMusicVideo.reasons.includes("OFFICIAL_MV_DURATION_TOLERANCE"));
  assert.ok(longOfficialMusicVideo.reasons.includes("OFFICIAL_MV_CHANNEL_ARTIST_HEURISTIC"));
}

const tooLongOfficialMusicVideo = matchTrack(shortTitle, [
  candidate({
    videoId: "officialmv2",
    title: "周杰倫 Jay Chou【晴天 Sunny Day】-Official Music Video",
    channelTitle: "周杰倫 Jay Chou",
    durationMs: 329_001,
  }),
]);
assert.equal(tooLongOfficialMusicVideo.kind, "unmatched");

const untrustedLongOfficialLabel = matchTrack(shortTitle, [
  candidate({
    videoId: "untrusted01",
    title: "周杰伦 - 晴天 Official Music Video",
    channelTitle: "Random Lyric Uploads",
    durationMs: 319_000,
  }),
]);
assert.equal(untrustedLongOfficialLabel.kind, "unmatched");
if (untrustedLongOfficialLabel.kind === "unmatched") {
  assert.equal(untrustedLongOfficialLabel.code, "DURATION_MISMATCH");
}

const purePerformance = matchTrack(
  {
    title: "光年之外",
    artists: ["邓紫棋"],
    durationMs: 230_000,
    origin: { provider: "netease", resourceId: "fixture-light-years" },
  },
  [
    candidate({
      videoId: "pureview001",
      title: "【纯享】GEM邓紫棋再唱《光年之外》",
      channelTitle: "SMG音乐频道",
      durationMs: 230_000,
    }),
  ],
);
assert.equal(purePerformance.kind, "unmatched");
if (purePerformance.kind === "unmatched") assert.equal(purePerformance.code, "VERSION_CONFLICT");

const ambiguous = matchTrack(baseTrack, [
  candidate({ videoId: "jkl________", searchRank: 0 }),
  candidate({ videoId: "kl_________", searchRank: 1 }),
]);
assert.equal(ambiguous.kind, "unmatched");
if (ambiguous.kind === "unmatched") assert.equal(ambiguous.code, "AMBIGUOUS_MATCH");

const selected = new TrackMatcher({ regionCode: "HK" }).match(baseTrack, [
  candidate({ videoId: "lm_________", title: "Love Story", channelTitle: "Various Artists", searchRank: 0 }),
  candidate({ videoId: "mnop_______", searchRank: 1 }),
]);
assert.equal(selected.kind, "matched");
if (selected.kind === "matched") assert.equal(selected.candidate.videoId, "mnop_______");

const officialAudioPreferred = matchTrack(baseTrack, [
  candidate({
    videoId: "lyricsrank0",
    title: "Taylor Swift - Love Story (Lyrics)",
    channelTitle: "Lyrics Archive",
    searchRank: 0,
  }),
  candidate({
    videoId: "offaudio001",
    title: "Taylor Swift - Love Story (Official Audio)",
    channelTitle: "Taylor Swift",
    searchRank: 8,
  }),
]);
assert.equal(officialAudioPreferred.kind, "matched");
if (officialAudioPreferred.kind === "matched") {
  assert.equal(officialAudioPreferred.candidate.videoId, "offaudio001");
  assert.ok(officialAudioPreferred.reasons.includes("OFFICIAL_AUDIO_CHANNEL_ARTIST_HEURISTIC"));
}

const topicPreferred = matchTrack(baseTrack, [
  candidate({
    videoId: "lyricsrank1",
    title: "Taylor Swift - Love Story (Lyrics)",
    channelTitle: "Lyrics Archive",
    searchRank: 0,
  }),
  candidate({
    videoId: "topictrack1",
    title: "Love Story",
    channelTitle: "Taylor Swift - Topic",
    searchRank: 9,
  }),
]);
assert.equal(topicPreferred.kind, "matched");
if (topicPreferred.kind === "matched") {
  assert.equal(topicPreferred.candidate.videoId, "topictrack1");
  assert.ok(topicPreferred.reasons.includes("ARTIST_TOPIC_CHANNEL"));
}

assert.equal(matchTrack(baseTrack, []).kind, "unmatched");
console.log("track matcher contract ok: normalize, versions, filters, duration, ranking, ambiguity");
