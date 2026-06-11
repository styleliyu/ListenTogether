import type { Server as HttpServer } from "http"
import { WebSocketServer } from "ws"
import { roomRepo } from "./repositories"
import { resolveQueueItemContent } from "./music/musicAdapter"
import { getPlaylistImportProgress, importPlaylistByLink, setPlaylistImportBroadcaster } from "./playlistImport"
import { buildPlaybackUpdate, canOperatePlayer, shouldIgnoreRapidSameOperator } from "./playbackService"
import { buildQueueRoomStatus, canOperateQueue, contentToQueueItem, getNextQueueIndex, getSkipQueueIndex, isPlayMode, moveQueueItemAfterCurrent, normalizeQueue, reconcileQueueCurrent, removeQueueItem, sanitizeQueueItems } from "./queueService"
import { broadcaster } from "./websocket/broadcaster"
import { DEFAULT_ROOM_CONFIG, canControlPlayback, canImportPlaylist, normalizeRoomConfig } from "./permissionService"
import { appendChatMessage, checkChatRateLimit, getChatHistory, normalizeChatContent } from "./chatService"
import { appendRoomNotice, getRoomNoticeHistory } from "./roomNoticeService"
import type {
  ContentData,
  Participant,
  QueueItem,
  ReqAppendQueue,
  ReqChatSend,
  ReqImportPlaylist,
  PtWebSocket,
  ReqAdvanceQueue,
  ReqBase,
  ReqOperatePlayer,
  ReqQueuePlayNext,
  ReqQueueRemoveItem,
  ReqQueueSkipCurrent,
  ReqSetPlayMode,
  ReqSetQueueIndex,
  Room,
  RoomConfig,
  RoomNoticeType,
  RoomQueue,
  RoomStatus,
  SpeedRate
} from "./types"

const LAZY_RESOLVE_ROOM_INTERVAL_MS = 2000
const LAZY_RESOLVE_FAIL_COOLDOWN_MS = 30 * 1000
const STALE_PAUSE_AFTER_QUEUE_SWITCH_MS = 2500
const defaultRoomCfg: RoomConfig = DEFAULT_ROOM_CONFIG

const lazyResolveRoomStamps = new Map<string, number>()
const lazyResolveFailCache = new Map<string, number>()
const queueSwitchPauseGuards = new Map<string, { guestId: string; until: number }>()

export function setupWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  setPlaylistImportBroadcaster((roomId, data) => {
    if (data.responseType === "PLAYLIST_IMPORT_PROGRESS" && data.playlistImportProgress) {
      broadcaster.broadcastPlaylistImportProgress(roomId, data.playlistImportProgress)
      return
    }
    broadcaster.broadcastToRoom(roomId, data)
  })

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`)
    if (url.pathname !== "/ws") return

    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit("connection", ws, request)
    })
  })

  wss.on("connection", ws => {
    const socket = ws as PtWebSocket
    socket.createStamp = Date.now()
    broadcaster.add(socket)
    broadcaster.send(socket, { responseType: "CONNECTED" })

    socket.on("message", data => {
      void handleMessage(socket, data)
    })
    socket.on("close", () => {
      broadcaster.remove(socket)
    })
    socket.on("error", err => {
      console.error("WebSocket error", err)
      broadcaster.remove(socket)
    })
  })

  return wss
}

async function handleMessage(socket: PtWebSocket, data: unknown): Promise<void> {
  const req = getReqObject(data)
  if (!req || !checkReqObject(req)) {
    socket.close()
    return
  }

  if (req.operateType !== "FIRST_SEND" && !isSocketInRoom(socket, req.roomId)) {
    socket.close()
    return
  }

  if (req.operateType === "FIRST_SEND") await handleFirstSend(socket, req)
  else if (req.operateType === "SET_PLAYER") await handleSetPlayer(socket, req as ReqOperatePlayer)
  else if (req.operateType === "SET_QUEUE_INDEX") await handleSetQueueIndex(socket, req as ReqSetQueueIndex)
  else if (req.operateType === "ADVANCE_QUEUE") await handleAdvanceQueue(socket, req as ReqAdvanceQueue)
  else if (req.operateType === "SET_PLAY_MODE") await handleSetPlayMode(socket, req as ReqSetPlayMode)
  else if (req.operateType === "APPEND_QUEUE") await handleAppendQueue(socket, req as ReqAppendQueue)
  else if (req.operateType === "IMPORT_PLAYLIST") await handleImportPlaylist(socket, req as ReqImportPlaylist)
  else if (req.operateType === "QUEUE_REMOVE_ITEM") await handleQueueRemoveItem(socket, req as ReqQueueRemoveItem)
  else if (req.operateType === "QUEUE_SKIP_CURRENT") await handleQueueSkipCurrent(socket, req as ReqQueueSkipCurrent)
  else if (req.operateType === "QUEUE_PLAY_NEXT") await handleQueuePlayNext(socket, req as ReqQueuePlayNext)
  else if (req.operateType === "CHAT_SEND") await handleChatSend(socket, req as ReqChatSend)
  else if (req.operateType === "HEARTBEAT") handleHeartbeat(socket, req)
}

function isSocketInRoom(socket: PtWebSocket, roomId: string): boolean {
  return Boolean(socket.roomId && socket.roomId === roomId)
}

function handleHeartbeat(socket: PtWebSocket, req: ReqBase): void {
  if (!socket.roomId || socket.roomId !== req.roomId) {
    socket.close()
    return
  }
  broadcaster.send(socket, { responseType: "HEARTBEAT" })
}

async function handleFirstSend(socket: PtWebSocket, req: ReqBase): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const guestId = getOperatorGuestId(req["x-pt-local-id"], room)
  if (!room || !guestId) {
    socket.close()
    return
  }

  const roomCfg = normalizeRoomConfig(room.config || defaultRoomCfg)
  const queue = normalizeQueue(room.queue)
  socket.roomId = req.roomId
  broadcaster.send(socket, {
    responseType: "NEW_STATUS",
    roomStatus: {
      roomId: req.roomId,
      roomName: room.roomName,
      content: room.content,
      playStatus: room.playStatus,
      speedRate: room.speedRate,
      operator: room.operator,
      contentStamp: room.contentStamp,
      operateStamp: room.operateStamp,
      everyoneCanOperatePlayer: roomCfg.everyoneCanOperatePlayer,
      permissions: roomCfg.permissions,
      queue,
      currentIndex: queue?.currentIndex,
      currentItemId: queue?.currentItemId,
      playMode: queue?.playMode
    }
  })
  broadcaster.send(socket, {
    responseType: "CHAT_HISTORY",
    chatMessages: getChatHistory(req.roomId)
  })
  broadcaster.send(socket, {
    responseType: "ROOM_NOTICE_HISTORY",
    roomNotices: getRoomNoticeHistory(req.roomId)
  })
  const progress = getPlaylistImportProgress(req.roomId)
  if (progress) {
    broadcaster.send(socket, {
      responseType: "PLAYLIST_IMPORT_PROGRESS",
      playlistImportProgress: progress
    })
  }
}

async function handleSetPlayer(socket: PtWebSocket, req: ReqOperatePlayer): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  if (!room) return

  const clientId = req["x-pt-local-id"]
  const isOwner = room.owner === clientId
  if (!canOperatePlayer(room, clientId, defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }

  const guestId = getOperatorGuestId(clientId, room)
  if (!guestId) {
    socket.close()
    return
  }

  if (shouldIgnoreStalePauseAfterQueueSwitch(req.roomId, guestId, req.playStatus)) return
  if (shouldIgnoreRapidSameOperator(room, guestId, req["x-pt-stamp"])) return

  const { patch, roomStatus } = buildPlaybackUpdate({ room, roomId: req.roomId, req, guestId, isOwner, defaultRoomCfg })
  await roomRepo.update(req.roomId, patch)
  broadcaster.broadcastRoomStatus(req.roomId, roomStatus)
}

async function handleSetQueueIndex(socket: PtWebSocket, req: ReqSetQueueIndex): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const queue = normalizeQueue(room?.queue)
  if (!room || !queue) return
  if (!canControlPlayback(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }
  await switchQueueIndex(req.roomId, { ...room, queue }, req.index, req["x-pt-stamp"], req["x-pt-local-id"], "PLAYING")
}

async function handleAdvanceQueue(socket: PtWebSocket, req: ReqAdvanceQueue): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const queue = normalizeQueue(room?.queue)
  if (!room || !queue) return
  if (!canControlPlayback(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }
  if (req.fromIndex !== queue.currentIndex) return

  const nextIndex = getNextQueueIndex(queue, req.direction)
  if (nextIndex < 0) {
    await pauseQueueAtEnd(req.roomId, { ...room, queue }, req)
    return
  }

  await switchQueueIndex(req.roomId, { ...room, queue }, nextIndex, req["x-pt-stamp"], req["x-pt-local-id"], "PLAYING")
}

async function handleSetPlayMode(socket: PtWebSocket, req: ReqSetPlayMode): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const baseQueue = normalizeQueue(room?.queue)
  if (!room || !baseQueue) return
  if (!canControlPlayback(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }
  const guestId = getOperatorGuestId(req["x-pt-local-id"], room)
  if (!guestId || !isPlayMode(req.playMode)) return

  const queue = normalizeQueue({ ...baseQueue, playMode: req.playMode }) as RoomQueue
  await roomRepo.update(req.roomId, { queue, operator: guestId })
  broadcaster.broadcastRoomStatus(req.roomId, buildQueueRoomStatus(req.roomId, room, queue, guestId))
  broadcastRoomNotice(req.roomId, "playback", `播放方式切换为${playModeLabel(queue.playMode)}`)
}

async function handleAppendQueue(socket: PtWebSocket, req: ReqAppendQueue): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  if (!room) return
  if (!canOperateQueue(room, req["x-pt-local-id"], defaultRoomCfg) && !canImportPlaylist(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }
  const guestId = getOperatorGuestId(req["x-pt-local-id"], room)
  if (!guestId) return

  const incoming = sanitizeQueueItems(req.items)
  if (!incoming.length) return

  const baseQueue: RoomQueue = normalizeQueue(room.queue)
    || { items: [contentToQueueItem(room.content)], currentIndex: 0, playMode: "sequence" }
  const queue = reconcileQueueCurrent(baseQueue, { ...baseQueue, items: [...baseQueue.items, ...incoming] })

  await roomRepo.update(req.roomId, { queue, operator: guestId })
  broadcaster.broadcastRoomStatus(req.roomId, buildQueueRoomStatus(req.roomId, room, queue, guestId))
  broadcastRoomNotice(req.roomId, "queue", `添加了 ${incoming.length} 首歌曲到队列`)
}

async function handleImportPlaylist(socket: PtWebSocket, req: ReqImportPlaylist): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  if (!room) return
  if (!canImportPlaylist(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }
  if (!getOperatorGuestId(req["x-pt-local-id"], room)) return
  if (!/^https?:\/\//i.test(req.link || "")) return

  const progress = await importPlaylistByLink(req.roomId, req.link)
  broadcaster.send(socket, {
    responseType: "PLAYLIST_IMPORT_PROGRESS",
    playlistImportProgress: progress
  })
  if (progress.status === "failed") {
    broadcastRoomNotice(req.roomId, "playlist_import", progress.message || "歌单导入失败")
  }
}

async function handleQueueRemoveItem(socket: PtWebSocket, req: ReqQueueRemoveItem): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const baseQueue = normalizeQueue(room?.queue)
  if (!room || !baseQueue) return
  if (!canOperateQueue(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }
  const guestId = getOperatorGuestId(req["x-pt-local-id"], room)
  if (!guestId) return

  const result = removeQueueItem(baseQueue, req.itemId)
  if (!result) return
  const removedItem = baseQueue.items.find(item => item.id === req.itemId)

  if (!result.queue.items.length) {
    await roomRepo.update(req.roomId, {
      queue: result.queue,
      playStatus: "PAUSED",
      contentStamp: 0,
      operateStamp: req["x-pt-stamp"],
      operator: guestId
    })
    broadcaster.broadcastRoomStatus(req.roomId, {
      roomId: req.roomId,
      content: room.content,
      playStatus: "PAUSED",
      speedRate: room.speedRate,
      contentStamp: 0,
      operateStamp: req["x-pt-stamp"],
      operator: guestId,
      queue: result.queue,
      currentIndex: result.queue.currentIndex,
      currentItemId: result.queue.currentItemId,
      playMode: result.queue.playMode
    })
    broadcastRoomNotice(req.roomId, "queue", `删除歌曲：${removedItem?.title || "未知歌曲"}`)
    return
  }

  if (result.removedCurrent) {
    await switchQueueIndex(req.roomId, { ...room, queue: result.queue }, result.queue.currentIndex, req["x-pt-stamp"], req["x-pt-local-id"], room.playStatus)
    broadcastRoomNotice(req.roomId, "queue", `删除当前歌曲：${removedItem?.title || "未知歌曲"}`)
    return
  }

  await roomRepo.update(req.roomId, {
    queue: result.queue,
    operator: guestId
  })
  broadcaster.broadcastRoomStatus(req.roomId, buildQueueRoomStatus(req.roomId, room, result.queue, guestId))
  broadcastRoomNotice(req.roomId, "queue", `删除歌曲：${removedItem?.title || "未知歌曲"}`)
}

async function handleQueueSkipCurrent(socket: PtWebSocket, req: ReqQueueSkipCurrent): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const queue = normalizeQueue(room?.queue)
  if (!room || !queue) return
  if (!canOperateQueue(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }

  const nextIndex = getSkipQueueIndex(queue)
  if (nextIndex < 0) {
    await pauseQueueAtEnd(req.roomId, { ...room, queue }, req)
    return
  }

  await switchQueueIndex(req.roomId, { ...room, queue }, nextIndex, req["x-pt-stamp"], req["x-pt-local-id"], room.playStatus)
}

async function handleQueuePlayNext(socket: PtWebSocket, req: ReqQueuePlayNext): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const baseQueue = normalizeQueue(room?.queue)
  if (!room || !baseQueue) return
  if (!canOperateQueue(room, req["x-pt-local-id"], defaultRoomCfg)) {
    sendOperationError(socket, req)
    return
  }
  const guestId = getOperatorGuestId(req["x-pt-local-id"], room)
  if (!guestId) return

  const queue = moveQueueItemAfterCurrent(baseQueue, req.itemId)
  if (!queue) return
  const targetItem = baseQueue.items.find(item => item.id === req.itemId)

  await roomRepo.update(req.roomId, {
    queue,
    operator: guestId
  })
  broadcaster.broadcastRoomStatus(req.roomId, buildQueueRoomStatus(req.roomId, room, queue, guestId))
  broadcastRoomNotice(req.roomId, "queue", `设为下一首：${targetItem?.title || "未知歌曲"}`)
}

async function handleChatSend(socket: PtWebSocket, req: ReqChatSend): Promise<void> {
  const room = await roomRepo.get(req.roomId)
  const participant = getRoomParticipant(req["x-pt-local-id"], room)
  if (!room || !participant) {
    socket.close()
    return
  }

  const contentResult = normalizeChatContent(req.content)
  if (!contentResult.ok || !contentResult.content) {
    sendOperationError(socket, req, contentResult.message || "消息发送失败")
    return
  }

  const rateLimit = checkChatRateLimit(req.roomId, participant.guestId)
  if (!rateLimit.allowed) {
    sendOperationError(socket, req, "发送太快了，请稍后再发")
    return
  }

  const chatMessage = appendChatMessage({
    roomId: req.roomId,
    senderId: participant.guestId,
    senderName: participant.nickName,
    content: contentResult.content
  })
  broadcaster.broadcastToRoom(req.roomId, {
    responseType: "CHAT_MESSAGE",
    chatMessage
  })
}

async function pauseQueueAtEnd(roomId: string, room: Room, req: ReqAdvanceQueue | ReqQueueSkipCurrent): Promise<void> {
  const guestId = getOperatorGuestId(req["x-pt-local-id"], room)
  if (!guestId) return
  await roomRepo.update(roomId, {
    playStatus: "PAUSED",
    contentStamp: 0,
    operateStamp: req["x-pt-stamp"],
    operator: guestId,
    queue: room.queue
  })
  broadcaster.broadcastRoomStatus(roomId, {
    roomId,
    playStatus: "PAUSED",
    speedRate: room.speedRate,
    contentStamp: 0,
    operateStamp: req["x-pt-stamp"],
    operator: guestId,
    queue: room.queue,
    currentIndex: room.queue?.currentIndex,
    currentItemId: room.queue?.currentItemId,
    playMode: room.queue?.playMode
  })
  broadcastRoomNotice(roomId, "playback", "队列播放结束")
}

async function switchQueueIndex(
  roomId: string,
  room: Room,
  index: number,
  stamp: number,
  clientId: string,
  nextPlayStatus: "PLAYING" | "PAUSED"
): Promise<void> {
  const baseQueue = normalizeQueue(room.queue)
  if (!baseQueue || index < 0 || index >= baseQueue.items.length) return
  const guestId = getOperatorGuestId(clientId, room)
  if (!guestId) return

  const targetItem = baseQueue.items[index]
  if (!targetItem.audioUrl && !canLazyResolveQueueItem(roomId, targetItem)) return
  const content = await resolveQueueItemContent(targetItem)
  if (!content?.audioUrl) {
    rememberLazyResolveFailure(targetItem)
    return
  }
  const queue: RoomQueue = {
    ...baseQueue,
    currentIndex: index,
    currentItemId: targetItem.id,
    items: baseQueue.items.map((item, idx) => idx === index ? { ...item, audioUrl: content.audioUrl } : item)
  }
  const cleanContent: ContentData = { ...content }
  delete cleanContent.queue
  rememberQueueSwitchPauseGuard(roomId, guestId)

  await roomRepo.update(roomId, {
    content: cleanContent,
    queue,
    playStatus: nextPlayStatus,
    contentStamp: 0,
    operateStamp: stamp,
    operator: guestId
  })
  broadcaster.broadcastRoomStatus(roomId, {
    roomId,
    content: cleanContent,
    playStatus: nextPlayStatus,
    speedRate: room.speedRate,
    contentStamp: 0,
    operateStamp: stamp,
    operator: guestId,
    queue,
    currentIndex: queue.currentIndex,
    currentItemId: queue.currentItemId,
    playMode: queue.playMode
  })
  broadcastRoomNotice(roomId, "playback", `切换歌曲：${targetItem.title || "未知歌曲"}`)
}

function canLazyResolveQueueItem(roomId: string, item: QueueItem): boolean {
  const now = Date.now()
  const itemKey = queueItemResolveKey(item)
  const failedAt = lazyResolveFailCache.get(itemKey)
  if (failedAt && now - failedAt < LAZY_RESOLVE_FAIL_COOLDOWN_MS) return false
  if (failedAt) lazyResolveFailCache.delete(itemKey)

  const lastRoomResolve = lazyResolveRoomStamps.get(roomId) || 0
  if (now - lastRoomResolve < LAZY_RESOLVE_ROOM_INTERVAL_MS) return false
  lazyResolveRoomStamps.set(roomId, now)
  return true
}

function rememberLazyResolveFailure(item: QueueItem): void {
  lazyResolveFailCache.set(queueItemResolveKey(item), Date.now())
}

function queueItemResolveKey(item: QueueItem): string {
  return `${item.sourceType}:${item.resourceId || item.linkUrl || item.id}`
}

function checkReqObject(data: ReqBase | ReqOperatePlayer | ReqSetQueueIndex | ReqAdvanceQueue | ReqSetPlayMode | ReqAppendQueue | ReqImportPlaylist | ReqQueueRemoveItem | ReqQueueSkipCurrent | ReqQueuePlayNext | ReqChatSend): boolean {
  if (!data) return false
  if (!data.operateType || !data.roomId || !data["x-pt-local-id"] || !data["x-pt-stamp"]) return false
  if (!["FIRST_SEND", "SET_PLAYER", "HEARTBEAT", "SET_QUEUE_INDEX", "ADVANCE_QUEUE", "SET_PLAY_MODE", "APPEND_QUEUE", "IMPORT_PLAYLIST", "QUEUE_REMOVE_ITEM", "QUEUE_SKIP_CURRENT", "QUEUE_PLAY_NEXT", "CHAT_SEND"].includes(data.operateType)) return false

  if (data.operateType === "SET_PLAYER") {
    const req = data as ReqOperatePlayer
    if (!req.playStatus || !req.speedRate) return false
    if (!["PLAYING", "PAUSED"].includes(req.playStatus)) return false
    if (!isSpeedRate(req.speedRate)) return false
    if (typeof req.contentStamp !== "number") return false
  }

  if (data.operateType === "SET_QUEUE_INDEX") {
    const req = data as ReqSetQueueIndex
    if (!Number.isInteger(req.index)) return false
  }

  if (data.operateType === "ADVANCE_QUEUE") {
    const req = data as ReqAdvanceQueue
    if (!["next", "prev", "auto"].includes(req.direction)) return false
    if (!Number.isInteger(req.fromIndex)) return false
  }

  if (data.operateType === "SET_PLAY_MODE") {
    const req = data as ReqSetPlayMode
    if (!isPlayMode(req.playMode)) return false
  }

  if (data.operateType === "APPEND_QUEUE") {
    const req = data as ReqAppendQueue
    if (!Array.isArray(req.items) || req.items.length < 1) return false
  }

  if (data.operateType === "IMPORT_PLAYLIST") {
    const req = data as ReqImportPlaylist
    if (typeof req.link !== "string" || !/^https?:\/\//i.test(req.link)) return false
  }

  if (data.operateType === "QUEUE_REMOVE_ITEM" || data.operateType === "QUEUE_PLAY_NEXT") {
    const req = data as ReqQueueRemoveItem | ReqQueuePlayNext
    if (typeof req.itemId !== "string" || !req.itemId.trim()) return false
  }

  if (data.operateType === "CHAT_SEND") {
    const req = data as ReqChatSend
    if (typeof req.content !== "string") return false
  }

  return true
}

function getReqObject(data: unknown): ReqBase | undefined {
  try {
    const tmpStr = Buffer.isBuffer(data) ? data.toString() : String(data || "")
    if (!tmpStr) return undefined
    return JSON.parse(tmpStr) as ReqBase
  } catch (err) {
    console.error("parse websocket message failed", err)
    return undefined
  }
}

function getOperatorGuestId(clientId: string, room?: Room): string | undefined {
  return getRoomParticipant(clientId, room)?.guestId
}

function getRoomParticipant(clientId: string, room?: Room): Participant | undefined {
  if (!room) return undefined
  if (room.oState === "EXPIRED" || room.oState === "DELETED") return undefined
  return room.participants.find(v => v.nonce === clientId)
}

function isSpeedRate(value: string): value is SpeedRate {
  return ["0.8", "1", "1.2", "1.5", "1.7"].includes(value)
}

function broadcastRoomNotice(roomId: string, type: RoomNoticeType, content: string): void {
  const text = content.trim()
  if (!text) return
  const notice = appendRoomNotice({ roomId, type, content: text })
  broadcaster.broadcastRoomNotice(roomId, notice)
}

function playModeLabel(playMode: string): string {
  if (playMode === "shuffle") return "随机"
  if (playMode === "single") return "单曲循环"
  return "顺序"
}

function sendOperationError(socket: PtWebSocket, req: ReqBase, message?: string): void {
  broadcaster.send(socket, {
    responseType: "OPERATION_ERROR",
    operationError: {
      roomId: req.roomId,
      operateType: req.operateType,
      message: message || getPermissionDeniedMessage(req.operateType)
    }
  })
}

function getPermissionDeniedMessage(operateType: string): string {
  if (operateType === "IMPORT_PLAYLIST") return "房主已关闭普通成员导入歌单权限"
  if (operateType === "QUEUE_REMOVE_ITEM" || operateType === "QUEUE_SKIP_CURRENT" || operateType === "QUEUE_PLAY_NEXT") {
    return "房主已关闭普通成员管理队列权限"
  }
  if (operateType === "APPEND_QUEUE") return "房主已关闭普通成员添加歌曲或导入歌单权限"
  return "房主已关闭普通成员播放控制权限"
}

function rememberQueueSwitchPauseGuard(roomId: string, guestId: string): void {
  queueSwitchPauseGuards.set(roomId, {
    guestId,
    until: Date.now() + STALE_PAUSE_AFTER_QUEUE_SWITCH_MS
  })
}

function shouldIgnoreStalePauseAfterQueueSwitch(roomId: string, guestId: string, playStatus: string): boolean {
  if (playStatus !== "PAUSED") return false
  const guard = queueSwitchPauseGuards.get(roomId)
  if (!guard) return false
  if (Date.now() > guard.until) {
    queueSwitchPauseGuards.delete(roomId)
    return false
  }
  return guard.guestId === guestId
}
