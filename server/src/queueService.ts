import type { ContentData, PlayMode, QueueItem, Room, RoomConfig, RoomQueue, RoomStatus } from "./types"
import { canManageQueue } from "./permissionService"

// Queue service owns queue shape and navigation rules. Future currentItemId,
// drag sort, delete, skip, and play-next logic should be normalized here.
export function canOperateQueue(room: Room, clientId: string, defaultRoomCfg: RoomConfig): boolean {
  return canManageQueue(room, clientId, defaultRoomCfg)
}

export function getNextQueueIndex(queue: RoomQueue, direction: "next" | "prev" | "auto"): number {
  const normalized = normalizeQueue(queue)
  if (!normalized || normalized.items.length < 1) return -1
  const currentIndex = normalized.currentIndex
  if (normalized.playMode === "single" && direction === "auto") return currentIndex
  if (normalized.playMode === "shuffle" && direction !== "prev") {
    if (normalized.items.length === 1) return currentIndex
    let next = currentIndex
    for (let i = 0; i < 8 && next === currentIndex; i++) next = Math.floor(Math.random() * normalized.items.length)
    return next === currentIndex ? (currentIndex + 1) % normalized.items.length : next
  }
  if (direction === "prev") return currentIndex > 0 ? currentIndex - 1 : 0
  const next = currentIndex + 1
  if (next >= normalized.items.length) return direction === "auto" ? -1 : currentIndex
  return next
}

export function getSkipQueueIndex(queue: RoomQueue): number {
  const normalized = normalizeQueue(queue)
  if (!normalized || normalized.items.length <= 1) return -1
  if (normalized.playMode === "shuffle") {
    let next = normalized.currentIndex
    for (let i = 0; i < 8 && next === normalized.currentIndex; i++) next = Math.floor(Math.random() * normalized.items.length)
    return next === normalized.currentIndex ? (normalized.currentIndex + 1) % normalized.items.length : next
  }
  const next = normalized.currentIndex + 1
  return next < normalized.items.length ? next : -1
}

export function normalizeQueue(queue: RoomQueue | undefined): RoomQueue | undefined {
  if (!queue) return undefined
  const items = Array.isArray(queue.items) ? queue.items : []
  const playMode = isPlayMode(queue.playMode) ? queue.playMode : "sequence"
  if (!items.length) {
    return {
      items: [],
      currentIndex: 0,
      playMode
    }
  }

  const currentItemIndex = queue.currentItemId
    ? items.findIndex(item => item.id === queue.currentItemId)
    : -1
  const currentIndex = currentItemIndex >= 0
    ? currentItemIndex
    : clampQueueIndex(queue.currentIndex, items.length)

  return {
    ...queue,
    items,
    currentIndex,
    currentItemId: items[currentIndex]?.id,
    playMode
  }
}

export function reconcileQueueCurrent(previous: RoomQueue | undefined, next: RoomQueue): RoomQueue {
  const previousQueue = normalizeQueue(previous)
  const nextQueue = normalizeQueue(next)
  if (!nextQueue) return { items: [], currentIndex: 0, playMode: "sequence" }

  const stableId = previousQueue?.currentItemId || previousQueue?.items[previousQueue.currentIndex]?.id
  if (!stableId) return nextQueue
  return normalizeQueue({ ...nextQueue, currentItemId: stableId }) || nextQueue
}

export function removeQueueItem(queue: RoomQueue, itemId: string): { queue: RoomQueue; removedCurrent: boolean; removedIndex: number } | undefined {
  const normalized = normalizeQueue(queue)
  if (!normalized) return undefined
  const removedIndex = normalized.items.findIndex(item => item.id === itemId)
  if (removedIndex < 0) return undefined

  const removed = normalized.items[removedIndex]
  const removedCurrent = removed.id === normalized.currentItemId || removedIndex === normalized.currentIndex
  const items = normalized.items.filter(item => item.id !== itemId)

  if (!items.length) {
    return {
      queue: { items: [], currentIndex: 0, playMode: normalized.playMode },
      removedCurrent,
      removedIndex
    }
  }

  if (!removedCurrent) {
    return {
      queue: normalizeQueue({ ...normalized, items }) as RoomQueue,
      removedCurrent,
      removedIndex
    }
  }

  const currentIndex = Math.min(removedIndex, items.length - 1)
  return {
    queue: normalizeQueue({ ...normalized, items, currentIndex, currentItemId: items[currentIndex]?.id }) as RoomQueue,
    removedCurrent,
    removedIndex
  }
}

export function moveQueueItemAfterCurrent(queue: RoomQueue, itemId: string): RoomQueue | undefined {
  const normalized = normalizeQueue(queue)
  if (!normalized || normalized.items.length < 2) return normalized
  if (itemId === normalized.currentItemId) return normalized

  const itemIndex = normalized.items.findIndex(item => item.id === itemId)
  if (itemIndex < 0) return undefined

  const moving = normalized.items[itemIndex]
  const withoutMoving = normalized.items.filter(item => item.id !== itemId)
  const currentIndex = withoutMoving.findIndex(item => item.id === normalized.currentItemId)
  if (currentIndex < 0) return normalized

  const items = [
    ...withoutMoving.slice(0, currentIndex + 1),
    moving,
    ...withoutMoving.slice(currentIndex + 1)
  ]
  return reconcileQueueCurrent(normalized, { ...normalized, items })
}

export function sanitizeQueueItems(items: QueueItem[] | undefined): QueueItem[] {
  if (!Array.isArray(items)) return []
  return items
    .filter(item => item && item.title && (item.audioUrl || item.resourceId))
    .map((item, index) => ({
      id: item.id || `${item.sourceType || "audio"}:${item.resourceId || item.audioUrl || Date.now()}:${index}`,
      sourceType: item.sourceType || "audio",
      title: item.title,
      artist: item.artist || "",
      imageUrl: item.imageUrl || "",
      linkUrl: item.linkUrl || "",
      resourceId: item.resourceId || "",
      audioUrl: item.audioUrl || ""
    }))
}

export function contentToQueueItem(content: ContentData): QueueItem {
  return {
    id: `${content.sourceType || "current"}:${content.linkUrl || content.audioUrl}`,
    sourceType: content.sourceType || "audio",
    title: content.title || content.seriesName || "当前音频",
    artist: content.seriesName || "",
    imageUrl: content.imageUrl || "",
    linkUrl: content.linkUrl || "",
    audioUrl: content.audioUrl
  }
}

export function buildQueueRoomStatus(
  roomId: string,
  room: Room,
  queue: RoomQueue,
  operator: string
): RoomStatus {
  const normalizedQueue = normalizeQueue(queue) || queue
  return {
    roomId,
    content: room.content,
    playStatus: room.playStatus,
    speedRate: room.speedRate,
    contentStamp: room.contentStamp,
    operateStamp: room.operateStamp,
    operator,
    queue: normalizedQueue,
    currentIndex: normalizedQueue.currentIndex,
    currentItemId: normalizedQueue.currentItemId,
    playMode: normalizedQueue.playMode
  }
}

export function isPlayMode(value: string): value is PlayMode {
  return ["sequence", "shuffle", "single"].includes(value)
}

function clampQueueIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) return 0
  if (index < 0) return 0
  if (index >= length) return length - 1
  return index
}
