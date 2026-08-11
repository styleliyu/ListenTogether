import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { TrackIdentity } from "../server/types.js";

interface Fixture {
  id: string;
  track: TrackIdentity;
  versionInterference?: string[];
}

interface ExpectedResult {
  id: string;
  expectedOutcome: "pending_manual" | "unmatched";
  mustRejectVersion?: string;
}

const require = createRequire(import.meta.url);
const tracks = require("../fixtures/tracks.json") as Fixture[];
const expectedResults = require("../fixtures/expected-results.json") as ExpectedResult[];

const chineseTitles = new Set(["晴天", "夜曲", "体面", "光年之外", "演员"]);
const englishTitles = new Set([
  "Love Story",
  "bad guy",
  "Bohemian Rhapsody",
  "Shape of You",
  "Yellow",
]);

assert.ok(tracks.length >= 10, "fixture set must contain at least 10 tracks");
assert.ok(
  tracks.filter((fixture) => chineseTitles.has(fixture.track.title)).length >= 5,
  "fixture set must contain at least five Chinese tracks",
);
assert.ok(
  tracks.filter((fixture) => englishTitles.has(fixture.track.title)).length >= 5,
  "fixture set must contain at least five non-Chinese tracks",
);
assert.ok(tracks.some((fixture) => fixture.track.title === "晴天"));
assert.ok(tracks.some((fixture) => fixture.track.title === "Love Story"));
assert.ok(
  tracks.filter((fixture) => (fixture.versionInterference?.length ?? 0) >= 2).length >= 3,
  "fixture set must include at least three version-interference groups",
);
assert.equal(
  expectedResults.find((result) => result.id === "en-love-story")?.mustRejectVersion,
  "taylor's version",
);
assert.equal(
  expectedResults.find((result) => result.id === "negative-does-not-exist")?.expectedOutcome,
  "unmatched",
);
assert.equal(new Set(tracks.map((fixture) => fixture.id)).size, tracks.length);
assert.equal(new Set(expectedResults.map((result) => result.id)).size, expectedResults.length);

console.log(`fixture schema ok: ${tracks.length} tracks`);
