import assert from "assert"
import { normalizeRoomForStorage } from "../src/repositories/normalizeRoomForStorage"
import type { Room } from "../src/types"

const room = {
  _id: "room-1",
  content: {
    infoType: "podcast",
    audioUrl: "https://example.com/audio.mp3",
    title: "测试音频",
  },
  oState: "OK",
  playStatus: "PLAYING",
  speedRate: "1.5",
  contentStamp: 51459.5,
  operateStamp: 1718091000000.7,
  operator: "guest-1",
  createStamp: 1718090000000.2,
  owner: "client-1",
  participants: [{
    nickName: "成员",
    enterStamp: 1718090000001.6,
    heartbeatStamp: 1718091000001.4,
    guestId: "guest-1",
    nonce: "client-1",
  }],
  queue: {
    items: [{
      id: "track-1",
      sourceType: "audio",
      title: "测试音频",
      audioUrl: "https://example.com/audio.mp3",
    }],
    currentIndex: 0.8,
    currentItemId: "track-1",
    playMode: "sequence",
  },
  emptyStamp: 1718091000002.9,
} satisfies Room

const normalized = normalizeRoomForStorage(room)

assert.equal(Number.isInteger(normalized.contentStamp), true)
assert.equal(normalized.contentStamp, 51460)
assert.equal(Number.isInteger(normalized.operateStamp), true)
assert.equal(Number.isInteger(normalized.createStamp), true)
assert.equal(Number.isInteger(normalized.emptyStamp), true)
assert.equal(Number.isInteger(normalized.participants[0].enterStamp), true)
assert.equal(Number.isInteger(normalized.participants[0].heartbeatStamp), true)
assert.equal(Number.isInteger(normalized.queue?.currentIndex), true)

console.log("normalize-room-storage.test passed")
