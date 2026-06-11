import type {
  ContentData,
  Participant,
  ParticipantClient,
  RequestContext,
  RequestRes,
  RoRes,
  Room,
  RoomConfig,
  RoomPermissionConfig,
  Visitor
} from "./types"
import { roomRepo, visitorRepo } from "./repositories"
import { startPlaylistImport, stopPlaylistImportForRoom } from "./playlistImport"
import { env } from "./config/env"
import { broadcaster } from "./websocket/broadcaster"
import { normalizeQueue } from "./queueService"
import { clearRoomChatHistory } from "./chatService"
import {
  DEFAULT_ROOM_CONFIG,
  assertRoomPermission,
  getOwnerGuestId,
  getRoomPermissions,
  normalizeRoomConfig,
  resolveOwnerAfterParticipants,
  sanitizeRoomPermissions
} from "./permissionService"

const MAX_ROOM_NUM = 15
const defaultRoomCfg: RoomConfig = DEFAULT_ROOM_CONFIG

// Room service owns room lifecycle and metadata: create, enter, leave,
// heartbeat, naming, deletion, and future permission entry points.
type OperateType = "CREATE" | "ENTER" | "HEARTBEAT" | "LEAVE" | "SET_ROOM_NAME" | "DELETE_ROOM" | "SET_ROOM_PERMISSIONS" | "TRANSFER_OWNER"

interface CommonBody {
  operateType: "ENTER" | "HEARTBEAT" | "LEAVE" | "SET_ROOM_NAME" | "DELETE_ROOM" | "SET_ROOM_PERMISSIONS" | "TRANSFER_OWNER"
  roomId: string
  nickName: string
  "x-pt-local-id": string
  roomName?: string
  permissions?: RoomPermissionConfig
  targetGuestId?: string
}

interface CreateBody {
  operateType: "CREATE"
  roomData: ContentData
  nickName?: string
  "x-pt-local-id": string
  isPersistent?: boolean
  roomName?: string
}

export async function handleRoomOperate(ctx: RequestContext): Promise<RequestRes<RoRes>> {
  const err = checkEntry(ctx)
  if (err) return err

  const operateType = ctx.body.operateType as OperateType
  const ua = ctx.headers["user-agent"]
  const ip = ctx.headers["x-real-ip"] || ctx.headers["x-forwarded-for"] || ctx.ip

  if (operateType === "CREATE") return handleCreate(ctx.body as CreateBody, ua, ip)
  if (operateType === "ENTER") return handleEnter(ctx.body as CommonBody, ua, ip)
  if (operateType === "HEARTBEAT") return handleHeartbeat(ctx.body as CommonBody)
  if (operateType === "LEAVE") return handleLeave(ctx.body as CommonBody)
  if (operateType === "SET_ROOM_NAME") return handleSetRoomName(ctx.body as CommonBody)
  if (operateType === "DELETE_ROOM") return handleDeleteRoom(ctx.body as CommonBody)
  if (operateType === "SET_ROOM_PERMISSIONS") return handleSetRoomPermissions(ctx.body as CommonBody)
  if (operateType === "TRANSFER_OWNER") return handleTransferOwner(ctx.body as CommonBody)

  return { code: "E4044" }
}

async function handleSetRoomName(body: CommonBody): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  const { roomId } = body
  const room = await roomRepo.get(roomId)
  if (!room || !room._id) return { code: "E4004" }
  if (room.oState === "EXPIRED") return { code: "E4006" }
  if (room.oState === "DELETED") return { code: "E4004" }
  if (room.owner !== clientId) return { code: "E4003" }

  const roomName = sanitizeRoomName(body.roomName)
  if (!roomName) return { code: "E4000", showMsg: "房间名称不能为空" }

  const next = await roomRepo.update(roomId, { roomName })
  broadcaster.broadcastRoomInfo(roomId, {
    roomId,
    roomName
  })
  return { code: "0000", data: toRoRes(next || { ...room, roomName }) }
}

async function handleDeleteRoom(body: CommonBody): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  const { roomId } = body
  const room = await roomRepo.get(roomId)
  if (!room || !room._id) return { code: "E4004" }
  if (room.oState === "EXPIRED") return { code: "E4006" }
  if (room.oState === "DELETED") {
    clearRoomChatHistory(roomId)
    return { code: "0000" }
  }
  if (room.owner !== clientId) return { code: "E4003" }
  if (!room.isPersistent) return { code: "E4000", showMsg: "只有常驻房间可以主动删除" }

  stopPlaylistImportForRoom(roomId)
  clearRoomChatHistory(roomId)
  await roomRepo.update(roomId, {
    oState: "DELETED",
    playStatus: "PAUSED",
    participants: [],
    emptyStamp: Date.now()
  })
  broadcaster.broadcastRoomDeleted(roomId)
  return { code: "0000", showMsg: "房间已删除" }
}

async function handleSetRoomPermissions(body: CommonBody): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  const { roomId } = body
  const room = await roomRepo.get(roomId)
  if (!room || !room._id) return { code: "E4004" }
  if (room.oState === "EXPIRED") return { code: "E4006" }
  if (room.oState === "DELETED") return { code: "E4004" }

  const permissionRes = assertRoomPermission<RoRes>(room.owner === clientId, "只有房主可以修改房间权限")
  if (permissionRes.code !== "0000") return permissionRes

  const permissions = sanitizeRoomPermissions(body.permissions, room.config)
  const config = normalizeRoomConfig({ ...room.config, permissions })
  const next = await roomRepo.update(roomId, { config }) || { ...room, config }
  broadcaster.broadcastRoomInfo(roomId, buildRoomInfo(next))
  return { code: "0000", data: toRoRes(next, getGuestIdByClientId(next, clientId), "Y") }
}

async function handleTransferOwner(body: CommonBody): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  const { roomId } = body
  const room = await roomRepo.get(roomId)
  if (!room || !room._id) return { code: "E4004" }
  if (room.oState === "EXPIRED") return { code: "E4006" }
  if (room.oState === "DELETED") return { code: "E4004" }

  const permissionRes = assertRoomPermission<RoRes>(room.owner === clientId, "只有房主可以转让房主")
  if (permissionRes.code !== "0000") return permissionRes

  const targetGuestId = typeof body.targetGuestId === "string" ? body.targetGuestId.trim() : ""
  if (!targetGuestId) return { code: "E4000", showMsg: "请选择新的房主" }

  const target = (room.participants || []).find(person => person.guestId === targetGuestId)
  if (!target) return { code: "E4004", showMsg: "目标成员不在当前房间" }
  if (target.nonce === clientId) return { code: "E4000", showMsg: "不能转让给自己" }

  const next = await roomRepo.update(roomId, { owner: target.nonce }) || { ...room, owner: target.nonce }
  broadcaster.broadcastRoomInfo(roomId, buildRoomInfo(next))
  return { code: "0000", data: toRoRes(next, getGuestIdByClientId(next, clientId), "N") }
}

async function handleLeave(body: CommonBody): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  const { roomId } = body
  let room = await roomRepo.get(roomId)
  if (!room || !room._id) return { code: "E4004" }
  if (room.oState === "EXPIRED") return { code: "E4006" }
  if (room.oState === "DELETED") return { code: "E4004" }
  if (room.participants.length < 1) return { code: "0000" }

  const me = room.participants.find(v => v.nonce === clientId)
  if (!me) return { code: "E4003" }

  if (room.participants.length === 1) {
    room = pausePlayer(room)
    room.participants = []
    room.emptyStamp = Date.now()
    await roomRepo.update(roomId, room)
    return { code: "0000" }
  }

  const participants = room.participants.filter(v => v.nonce !== clientId)
  const owner = resolveOwnerAfterParticipants(room, participants)
  const next = await roomRepo.update(roomId, { participants, owner }) || { ...room, participants, owner }
  if (owner !== room.owner) broadcaster.broadcastRoomInfo(roomId, buildRoomInfo(next))
  return { code: "0000" }
}

async function handleHeartbeat(body: CommonBody): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  const { roomId, nickName } = body
  const room = await roomRepo.get(roomId)
  if (!room || !room._id) return { code: "E4004" }
  if (room.oState === "EXPIRED") return { code: "E4006" }
  if (room.oState === "DELETED") return { code: "E4004" }

  const now = Date.now()
  let participants = room.participants || []
  const me = participants.find(v => v.nonce === clientId)
  if (!me) return { code: "E4003" }

  me.heartbeatStamp = now
  me.nickName = nickName
  participants = participants.map(v => (v.nonce === clientId ? me : v))
  participants = participants.filter(v => now - v.heartbeatStamp < env.visitorOfflineTimeoutMs)
  const owner = resolveOwnerAfterParticipants(room, participants)

  const next = await roomRepo.update(roomId, { participants, owner }) || { ...room, participants, owner }
  if (owner !== room.owner) broadcaster.broadcastRoomInfo(roomId, buildRoomInfo(next))
  return {
    code: "0000",
    data: toRoRes(next, undefined, owner === clientId ? "Y" : "N")
  }
}

async function handleEnter(
  body: CommonBody,
  ua?: string,
  ip?: string | string[]
): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  const { roomId, nickName } = body
  const room = await roomRepo.get(roomId)
  if (!room || !room._id) return { code: "E4004" }
  if (room.oState === "EXPIRED") return { code: "E4006" }
  if (room.oState === "DELETED") return { code: "E4004" }

  const now = Date.now()
  let participants = room.participants || []
  let guestId = ""
  let me = participants.find(v => v.nonce === clientId)

  if (me) {
    guestId = me.guestId
    me.nickName = nickName
    me.enterStamp = now
    me.heartbeatStamp = now
    if (ua) me.userAgent = ua
    participants = participants.map(v => (v.nonce === clientId ? me as Participant : v))
  } else {
    if (participants.length >= MAX_ROOM_NUM) return { code: "R0001" }
    guestId = generateGuestId(participants)
    me = {
      nickName,
      enterStamp: now,
      heartbeatStamp: now,
      userAgent: ua,
      guestId,
      nonce: clientId
    }
    participants.push(me)
  }

  participants = participants.filter(v => now - v.heartbeatStamp < env.visitorOfflineTimeoutMs)
  const owner = resolveOwnerAfterParticipants(room, participants)
  await recordVisitor(body, ua, ip)
  const next = await roomRepo.update(roomId, { participants, owner, emptyStamp: undefined }) || { ...room, participants, owner }
  if (owner !== room.owner) broadcaster.broadcastRoomInfo(roomId, buildRoomInfo(next))

  return {
    code: "0000",
    data: toRoRes(next, guestId, owner === clientId ? "Y" : "N")
  }
}

async function handleCreate(
  body: CreateBody,
  ua?: string,
  ip?: string | string[]
): Promise<RequestRes<RoRes>> {
  const clientId = body["x-pt-local-id"]
  await recordVisitor(body, ua, ip)

  const now = Date.now()
  const room: Omit<Room, "_id"> = {
    content: stripQueueFromContent(body.roomData),
    oState: "OK",
    playStatus: "PAUSED",
    speedRate: "1",
    contentStamp: 0,
    operateStamp: now,
    operator: "",
    createStamp: now,
    owner: clientId,
    participants: [],
    config: normalizeRoomConfig(defaultRoomCfg),
    queue: normalizeQueue(body.roomData.queue),
    isPersistent: Boolean(body.isPersistent),
    roomName: sanitizeRoomName(body.roomName)
  }
  const roomId = await roomRepo.add(room)
  if (body.roomData.pendingPlaylistImport) {
    startPlaylistImport({
      roomId,
      link: body.roomData.pendingPlaylistImport.link,
      items: body.roomData.pendingPlaylistImport.items,
      importedItemIds: body.roomData.pendingPlaylistImport.importedItemIds
    })
  }
  return {
    code: "0000",
    data: {
      roomId,
      content: room.content,
      playStatus: "PAUSED",
      speedRate: "1",
      operator: "",
      contentStamp: 0,
      operateStamp: now,
      participants: [],
      iamOwner: "Y",
      roomRole: "owner",
      everyoneCanOperatePlayer: defaultRoomCfg.everyoneCanOperatePlayer,
      permissions: getRoomPermissions(defaultRoomCfg),
      queue: room.queue,
      currentIndex: room.queue?.currentIndex,
      currentItemId: room.queue?.currentItemId,
      playMode: room.queue?.playMode,
      isPersistent: room.isPersistent,
      roomName: room.roomName
    }
  }
}

function sanitizeRoomName(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, 30)
}

function stripQueueFromContent(content: ContentData): ContentData {
  const { queue, pendingPlaylistImport, ...rest } = content
  return rest
}

export function pausePlayer(room: Room, operator = ""): Room {
  if (room.playStatus === "PAUSED") return room

  const next = { ...room, participants: [...(room.participants || [])] }
  next.playStatus = "PAUSED"
  let speedRateNum = Number(next.speedRate)
  if (Number.isNaN(speedRateNum) || speedRateNum >= 1.71) speedRateNum = 1

  if (next.participants.length > 0) {
    let lastHeartbeat = next.operateStamp
    for (const person of next.participants) {
      if (person.heartbeatStamp > lastHeartbeat) lastHeartbeat = person.heartbeatStamp
    }
    const diffStamp = lastHeartbeat - next.operateStamp
    next.contentStamp = next.contentStamp + diffStamp * speedRateNum
    next.operateStamp = Date.now()
    next.operator = operator
  }

  return next
}

export function toRoRes(room: Room, guestId?: string, iamOwner?: "Y" | "N"): RoRes {
  const config = normalizeRoomConfig(room.config || defaultRoomCfg)
  const queue = normalizeQueue(room.queue)
  const ownerGuestId = getOwnerGuestId(room)
  const resolvedIamOwner = iamOwner || (guestId && ownerGuestId === guestId ? "Y" : "N")
  const participants: ParticipantClient[] = (room.participants || []).map(v => ({
    nickName: v.nickName,
    guestId: v.guestId,
    heartbeatStamp: v.heartbeatStamp,
    enterStamp: v.enterStamp
  }))

  return {
    roomId: room._id,
    roomName: room.roomName,
    content: room.content,
    playStatus: room.playStatus,
    speedRate: room.speedRate,
    operator: room.operator,
    contentStamp: room.contentStamp,
    operateStamp: room.operateStamp,
    participants,
    guestId,
    iamOwner: resolvedIamOwner,
    roomRole: resolvedIamOwner === "Y" ? "owner" : "member",
    ownerGuestId,
    everyoneCanOperatePlayer: config.everyoneCanOperatePlayer,
    permissions: config.permissions,
    queue,
    currentIndex: queue?.currentIndex,
    currentItemId: queue?.currentItemId,
    playMode: queue?.playMode,
    isPersistent: room.isPersistent
  }
}

function buildRoomInfo(room: Room): NonNullable<import("./types").ResToFe["roomInfo"]> {
  const config = normalizeRoomConfig(room.config || defaultRoomCfg)
  return {
    roomId: room._id,
    roomName: room.roomName,
    ownerGuestId: getOwnerGuestId(room),
    everyoneCanOperatePlayer: config.everyoneCanOperatePlayer,
    permissions: config.permissions
  }
}

function getGuestIdByClientId(room: Room, clientId: string): string | undefined {
  return (room.participants || []).find(person => person.nonce === clientId)?.guestId
}

function generateGuestId(participants: Participant[]): string {
  const abc = "abcdefghijkmnopqrstuvwyz123456789"
  const ids = participants.map(v => v.guestId)

  for (let runTimes = 0; runTimes <= 15; runTimes++) {
    let id = ""
    for (let i = 0; i < 11; i++) {
      id += abc[Math.floor(Math.random() * abc.length)]
    }
    if (!ids.includes(id)) return id
  }

  return `${Date.now()}`
}

function checkEntry(ctx: RequestContext): RequestRes<RoRes> | null {
  const { body = {}, method } = ctx
  if (method !== "POST") return { code: "E4005" }
  if (!body["x-pt-local-id"]) return { code: "E4000" }

  const operateType = body.operateType as OperateType | undefined
  const oTypes: OperateType[] = ["CREATE", "ENTER", "HEARTBEAT", "LEAVE", "SET_ROOM_NAME", "DELETE_ROOM", "SET_ROOM_PERMISSIONS", "TRANSFER_OWNER"]
  if (!operateType || !oTypes.includes(operateType)) return { code: "E4000" }
  if (!body.nickName && operateType !== "CREATE") return { code: "E4000" }

  const needsRoomId: OperateType[] = ["ENTER", "HEARTBEAT", "LEAVE", "SET_ROOM_NAME", "DELETE_ROOM", "SET_ROOM_PERMISSIONS", "TRANSFER_OWNER"]
  if (!body.roomId && needsRoomId.includes(operateType)) return { code: "E4000" }
  if (operateType === "SET_ROOM_NAME" && !sanitizeRoomName(body.roomName)) return { code: "E4000" }

  if (operateType === "CREATE") {
    const rawRoomName = body.roomName
    if (typeof rawRoomName === "string" && rawRoomName.length > 0 && !sanitizeRoomName(rawRoomName)) {
      return { code: "E4000", showMsg: "房间名称不能为空" }
    }
    const roomData = body.roomData as ContentData | undefined
    if (!roomData) return { code: "E4000" }
    if (roomData.infoType !== "podcast") return { code: "E4000" }
    if (!roomData.audioUrl) return { code: "E4000", errMsg: "roomData.audioUrl is required" }
  }

  return null
}

async function recordVisitor(
  body: CommonBody | CreateBody,
  ua?: string,
  ip?: string | string[]
): Promise<boolean> {
  const operateType = body.operateType
  const nonce = body["x-pt-local-id"]
  const nickName = body.nickName || ""
  const now = Date.now()
  const existing = await visitorRepo.getByNonce(nonce)

  if (existing) {
    const next: Visitor = {
      ...existing,
      nickName: nickName || existing.nickName,
      ip: ip || existing.ip
    }
    if (operateType === "CREATE") {
      next.createRoomStamp = now
      next.createNum += 1
    } else {
      next.enterRoomStamp = now
      next.enterNum += 1
    }
    await visitorRepo.update(next._id, next)
    return true
  }

  await visitorRepo.add({
    nickName,
    enterRoomStamp: operateType === "ENTER" ? now : -1,
    enterNum: operateType === "ENTER" ? 1 : 0,
    createNum: operateType === "CREATE" ? 1 : 0,
    createRoomStamp: operateType === "CREATE" ? now : -1,
    createStamp: now,
    userAgent: ua,
    ip,
    nonce
  })
  return true
}
