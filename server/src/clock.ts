import { roomRepo } from "./repositories"
import { env } from "./config/env"
import type { Room } from "./types"
import { getOwnerGuestId, normalizeRoomConfig, resolveOwnerAfterParticipants } from "./permissionService"
import { broadcaster } from "./websocket/broadcaster"
import { clearRoomChatHistory } from "./chatService"

export function startRoomClock(intervalMs: number): NodeJS.Timeout {
  const run = async () => {
    try {
      await handleRoomClock()
    } catch (err) {
      console.error("room clock failed", err)
    }
  }

  void run()
  return setInterval(run, intervalMs)
}

async function handleRoomClock(): Promise<void> {
  const rooms = roomRepo.findActiveRooms()
  if (rooms.length < 1) return

  const now = Date.now()
  for (const room of rooms) {
    let participants = room.participants || []
    let lastHeartbeat = room.createStamp

    if (participants.length < 1) {
      handleEmptyRoom(room, now)
      continue
    }

    const oldLen = participants.length
    const offlineBefore = now - env.visitorOfflineTimeoutMs
    participants = participants.filter(person => {
      if (person.heartbeatStamp > lastHeartbeat) lastHeartbeat = person.heartbeatStamp
      return person.heartbeatStamp > offlineBefore
    })

    if (participants.length === oldLen) continue

    const owner = resolveOwnerAfterParticipants(room, participants)
    const patch: Partial<Room> = { participants, owner }
    if (participants.length === 0) {
      patch.emptyStamp = room.emptyStamp || lastHeartbeat || now
      if (room.playStatus === "PLAYING" && now - lastHeartbeat >= env.roomIdlePauseTimeoutMs) {
        Object.assign(patch, buildPausePatch(room, lastHeartbeat, now))
      }
    }

    const next = roomRepo.update(room._id, patch)
    if (owner !== room.owner && next) {
      const config = normalizeRoomConfig(next.config)
      broadcaster.broadcastRoomInfo(room._id, {
        roomId: room._id,
        roomName: next.roomName,
        ownerGuestId: getOwnerGuestId(next),
        everyoneCanOperatePlayer: config.everyoneCanOperatePlayer,
        permissions: config.permissions
      })
    }
  }
}

function handleEmptyRoom(room: Room, now: number): void {
  const emptyStamp = room.emptyStamp || now
  const patch: Partial<Room> = {}

  if (!room.emptyStamp) patch.emptyStamp = emptyStamp
  if (room.playStatus === "PLAYING" && now - emptyStamp >= env.roomIdlePauseTimeoutMs) {
    Object.assign(patch, buildPausePatch(room, emptyStamp, now))
  }
  if (!room.isPersistent && now - emptyStamp >= env.tempRoomDeleteAfterEmptyMs) {
    patch.oState = "DELETED"
    patch.participants = []
  }

  if (Object.keys(patch).length > 0) {
    roomRepo.update(room._id, patch)
    if (patch.oState === "DELETED") clearRoomChatHistory(room._id)
  }
}

function buildPausePatch(room: Room, lastHeartbeat: number, now: number): Partial<Room> {
  let speedRateNum = Number(room.speedRate)
  if (Number.isNaN(speedRateNum) || speedRateNum >= 1.71) speedRateNum = 1
  const diffMilli = Math.max(0, lastHeartbeat - room.operateStamp)
  return {
    playStatus: "PAUSED",
    contentStamp: room.contentStamp + diffMilli * speedRateNum,
    operateStamp: now,
    operator: ""
  }
}
