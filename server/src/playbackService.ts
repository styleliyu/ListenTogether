import type { ReqOperatePlayer, Room, RoomConfig, RoomStatus } from "./types"
import { canControlPlayback, normalizeRoomConfig } from "./permissionService"
import { toPlaybackMs, toTimestampMs } from "./repositories/normalizeRoomForStorage"

export const MIN_DURATION_FOR_A_PERSON = 250

// Playback service owns play/pause/seek timestamps and speedRate reporting.
// It should not mutate queue order or room metadata.
export function canOperatePlayer(room: Room, clientId: string, defaultRoomCfg: RoomConfig): boolean {
  return canControlPlayback(room, clientId, defaultRoomCfg)
}

export function shouldIgnoreRapidSameOperator(room: Room, guestId: string, operateStamp: number): boolean {
  return guestId === room.operator && operateStamp - room.operateStamp < MIN_DURATION_FOR_A_PERSON
}

export function buildPlaybackUpdate(input: {
  room: Room
  roomId: string
  req: ReqOperatePlayer
  guestId: string
  isOwner: boolean
  defaultRoomCfg: RoomConfig
}): { patch: Partial<Room>; roomStatus: RoomStatus } {
  const { room, roomId, req, guestId, isOwner, defaultRoomCfg } = input
  const roomCfg = normalizeRoomConfig(room.config || defaultRoomCfg)
  const newRoomCfg = { ...roomCfg }
  const contentStamp = toPlaybackMs(req.contentStamp)
  const operateStamp = toTimestampMs(req["x-pt-stamp"])
  const patch: Partial<Room> = {
    playStatus: req.playStatus,
    speedRate: req.speedRate,
    contentStamp,
    operateStamp,
    operator: guestId
  }

  const roomStatus: RoomStatus = {
    roomId,
    playStatus: req.playStatus,
    speedRate: req.speedRate,
    contentStamp,
    operateStamp,
    operator: guestId
  }

  if (req.everyoneCanOperatePlayer && isOwner) {
    newRoomCfg.everyoneCanOperatePlayer = req.everyoneCanOperatePlayer
    newRoomCfg.permissions = {
      ...roomCfg.permissions,
      memberCanControlPlayback: req.everyoneCanOperatePlayer !== "N"
    }
    patch.config = newRoomCfg
    roomStatus.everyoneCanOperatePlayer = req.everyoneCanOperatePlayer
    roomStatus.permissions = newRoomCfg.permissions
  }

  return { patch, roomStatus }
}
