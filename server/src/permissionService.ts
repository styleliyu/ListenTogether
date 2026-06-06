import type {
  Participant,
  RequestRes,
  Room,
  RoomConfig,
  RoomPermissionConfig,
  RoomRole
} from "./types"

export const DEFAULT_ROOM_PERMISSIONS: RoomPermissionConfig = {
  memberCanControlPlayback: true,
  memberCanManageQueue: true,
  memberCanImportPlaylist: true
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  everyoneCanOperatePlayer: "Y",
  permissions: DEFAULT_ROOM_PERMISSIONS
}

type NormalizedRoomConfig = RoomConfig & {
  everyoneCanOperatePlayer: "Y" | "N"
  permissions: RoomPermissionConfig
}

export function getRoomPermissions(config?: RoomConfig): RoomPermissionConfig {
  const legacyAllowed = config?.everyoneCanOperatePlayer === "N" ? false : true
  return {
    memberCanControlPlayback: config?.permissions?.memberCanControlPlayback ?? legacyAllowed,
    memberCanManageQueue: config?.permissions?.memberCanManageQueue ?? legacyAllowed,
    memberCanImportPlaylist: config?.permissions?.memberCanImportPlaylist ?? legacyAllowed
  }
}

export function normalizeRoomConfig(config?: RoomConfig): NormalizedRoomConfig {
  const permissions = getRoomPermissions(config)
  return {
    ...config,
    everyoneCanOperatePlayer: permissions.memberCanControlPlayback ? "Y" : "N",
    permissions
  }
}

export function sanitizeRoomPermissions(
  value: unknown,
  current?: RoomConfig
): RoomPermissionConfig {
  const fallback = getRoomPermissions(current)
  if (!value || typeof value !== "object") return fallback

  const raw = value as Partial<Record<keyof RoomPermissionConfig, unknown>>
  return {
    memberCanControlPlayback: typeof raw.memberCanControlPlayback === "boolean"
      ? raw.memberCanControlPlayback
      : fallback.memberCanControlPlayback,
    memberCanManageQueue: typeof raw.memberCanManageQueue === "boolean"
      ? raw.memberCanManageQueue
      : fallback.memberCanManageQueue,
    memberCanImportPlaylist: typeof raw.memberCanImportPlaylist === "boolean"
      ? raw.memberCanImportPlaylist
      : fallback.memberCanImportPlaylist
  }
}

export function isRoomOwner(room: Room, clientId: string): boolean {
  return room.owner === clientId
}

export function getRoomRole(room: Room, clientId: string): RoomRole {
  return isRoomOwner(room, clientId) ? "owner" : "member"
}

export function canControlPlayback(room: Room, clientId: string, defaultRoomCfg: RoomConfig = DEFAULT_ROOM_CONFIG): boolean {
  const roomCfg = normalizeRoomConfig(room.config || defaultRoomCfg)
  return isRoomOwner(room, clientId) || roomCfg.permissions.memberCanControlPlayback
}

export function canManageQueue(room: Room, clientId: string, defaultRoomCfg: RoomConfig = DEFAULT_ROOM_CONFIG): boolean {
  const roomCfg = normalizeRoomConfig(room.config || defaultRoomCfg)
  return isRoomOwner(room, clientId) || roomCfg.permissions.memberCanManageQueue
}

export function canImportPlaylist(room: Room, clientId: string, defaultRoomCfg: RoomConfig = DEFAULT_ROOM_CONFIG): boolean {
  const roomCfg = normalizeRoomConfig(room.config || defaultRoomCfg)
  return isRoomOwner(room, clientId) || roomCfg.permissions.memberCanImportPlaylist
}

export function assertRoomPermission<T = Record<string, unknown>>(allowed: boolean, showMsg = "你没有权限执行这个操作"): RequestRes<T> {
  return allowed ? { code: "0000" } : { code: "E4003", showMsg }
}

export function getOwnerGuestId(room: Room): string | undefined {
  return (room.participants || []).find(person => person.nonce === room.owner)?.guestId
}

export function resolveOwnerAfterParticipants(room: Room, participants: Participant[]): string {
  if (room.isPersistent) return room.owner
  if (participants.some(person => person.nonce === room.owner)) return room.owner
  return participants[0]?.nonce || room.owner
}
