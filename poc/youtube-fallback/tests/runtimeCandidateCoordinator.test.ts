import assert from "node:assert/strict";
import { RuntimeCandidateCoordinator } from "../server/runtimeCandidateCoordinator.js";
import type { ResolveCandidateView, YouTubeVideoDetails } from "../server/types.js";

let now = 1_000;
const coordinator = new RuntimeCandidateCoordinator({
  now: () => now,
  createId: () => "resolution-test",
  sessionTtlMs: 1_000,
  failureTtlMs: 5_000,
});

function candidate(videoId: string): YouTubeVideoDetails {
  return {
    videoId,
    title: "Love Story",
    channelTitle: "Taylor Swift",
    searchRank: 0,
    durationMs: 236_000,
    embeddable: true,
  };
}

const selected: ResolveCandidateView = {
  candidate: candidate("selected001"),
  decision: "selected",
  reasons: ["TITLE_EXACT"],
};
const eligible: ResolveCandidateView = {
  candidate: { ...candidate("eligible01"), searchRank: 0 },
  decision: "eligible",
  reasons: ["TITLE_EXACT", "ARTIST_MATCH_1"],
};
const topic: ResolveCandidateView = {
  candidate: { ...candidate("topiccand01"), searchRank: 9 },
  decision: "eligible",
  reasons: ["TITLE_EXACT", "ARTIST_MATCH_1", "ARTIST_TOPIC_CHANNEL"],
};
const rejected: ResolveCandidateView = {
  candidate: candidate("rejected001"),
  decision: "rejected",
  reasons: ["VERSION_CONFLICT"],
};

const resolutionId = coordinator.createResolution(
  [selected, rejected, eligible, topic, eligible],
  selected.candidate.videoId,
  "hk",
);
assert.equal(resolutionId, "resolution-test");

const stale = coordinator.reportFailure({
  resolutionId,
  videoId: eligible.candidate.videoId,
  errorCode: 150,
});
assert.equal(stale.kind, "error");
if (stale.kind === "error") assert.equal(stale.code, "STALE_CANDIDATE");

const switched = coordinator.reportFailure({
  resolutionId,
  videoId: selected.candidate.videoId,
  errorCode: 150,
});
assert.equal(switched.kind, "switched");
if (switched.kind === "switched") assert.equal(switched.candidate.videoId, topic.candidate.videoId);
assert.equal(coordinator.isRuntimeRejected(selected.candidate.videoId, "HK"), true);
assert.equal(coordinator.isRuntimeRejected(selected.candidate.videoId, "US"), false);

const switchedAgain = coordinator.reportFailure({
  resolutionId,
  videoId: topic.candidate.videoId,
  errorCode: 101,
});
assert.equal(switchedAgain.kind, "switched");
if (switchedAgain.kind === "switched") {
  assert.equal(switchedAgain.candidate.videoId, eligible.candidate.videoId);
}

const exhausted = coordinator.reportFailure({
  resolutionId,
  videoId: eligible.candidate.videoId,
  errorCode: 150,
});
assert.equal(exhausted.kind, "exhausted");
assert.deepEqual(
  coordinator
    .filterRuntimeRejected(
      [selected.candidate, eligible.candidate, topic.candidate, rejected.candidate],
      "HK",
    )
    .map((item) => item.videoId),
  [rejected.candidate.videoId],
);

const gone = coordinator.reportFailure({
  resolutionId,
  videoId: eligible.candidate.videoId,
  errorCode: 101,
});
assert.equal(gone.kind, "error");
if (gone.kind === "error") assert.equal(gone.code, "RESOLUTION_NOT_FOUND");

now += 5_001;
assert.equal(coordinator.isRuntimeRejected(selected.candidate.videoId, "HK"), false);

console.log("runtime coordinator contract ok: authority, stale guard, failover, region TTL cache");
