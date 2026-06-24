import type { Participant, Room, RoomQueue } from "../types"

export function normalizeRoomForStorage(room: Room): Room {
  return {
    ...room,
    contentStamp: toPlaybackMs(room.contentStamp),
    operateStamp: toTimestampMs(room.operateStamp),
    createStamp: toTimestampMs(room.createStamp),
    emptyStamp: room.emptyStamp === undefined ? undefined : toTimestampMs(room.emptyStamp),
    participants: (room.participants || []).map(normalizeParticipantForStorage),
    queue: normalizeQueueForStorage(room.queue),
  }
}

export function toPlaybackMs(value: number): number {
  return toInteger(value, Math.round)
}

export function toTimestampMs(value: number): number {
  return toInteger(value, Math.round)
}

function normalizeParticipantForStorage(participant: Participant): Participant {
  return {
    ...participant,
    enterStamp: toTimestampMs(participant.enterStamp),
    heartbeatStamp: toTimestampMs(participant.heartbeatStamp),
  }
}

function normalizeQueueForStorage(queue?: RoomQueue): RoomQueue | undefined {
  if (!queue) return undefined
  return {
    ...queue,
    currentIndex: toInteger(queue.currentIndex, Math.trunc),
  }
}

function toInteger(value: number, round: (value: number) => number): number {
  if (!Number.isFinite(value)) return 0
  return round(value)
}
