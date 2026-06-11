import { roomRepo } from "./repositories"
import { getPlaylistImportData, resolveQueueItemContent, toPlayableQueueItem } from "./music/musicAdapter"
import { normalizeQueue, reconcileQueueCurrent } from "./queueService"
import type { ContentData, FailedTrack, PlaylistImportProgress, QueueItem, RequestRes, ResToFe, Room, RoomQueue } from "./types"

const IMPORT_DELAY_MIN_MS = 800
const IMPORT_DELAY_MAX_MS = 1500
const MAX_FAILED_TRACK_DETAILS = 50
const MAX_RAW_REASON_LENGTH = 200

// Playlist import owns progressive parsing, cancellation, progress broadcasts,
// and failedTracks details. It must never append to deleted rooms.
interface PlaylistImportJob {
  roomId: string
  link: string
  total: number
  parsedCount: number
  successCount: number
  failedCount: number
  failedTracks: FailedTrack[]
  addedCount: number
  running: boolean
  cancelled: boolean
  importedIds: Set<string>
}

type RoomBroadcaster = (roomId: string, data: ResToFe) => void

const activeJobs = new Map<string, PlaylistImportJob>()
let broadcastToRoom: RoomBroadcaster = () => {}

export function setPlaylistImportBroadcaster(fn: RoomBroadcaster): void {
  broadcastToRoom = fn
}

export async function importPlaylistByLink(roomId: string, link: string): Promise<PlaylistImportProgress> {
  const existing = activeJobs.get(roomId)
  if (existing?.running) return toProgress(existing, "progress", "歌单正在导入中")

  const res = await getPlaylistImportData(link)
  if (!res || res.code !== "0000" || !res.data?.items.length) {
    return {
      status: "failed",
      roomId,
      link,
      total: 0,
      parsedCount: 0,
      successCount: 0,
      failedCount: 0,
      addedCount: 0,
      message: res?.showMsg || "歌单解析失败，请更换链接或稍后再试。"
    }
  }

  return startPlaylistImport({
    roomId,
    link: res.data.link,
    items: res.data.items
  })
}

export function startPlaylistImport(input: {
  roomId: string
  link: string
  items: QueueItem[]
  importedItemIds?: string[]
}): PlaylistImportProgress {
  const existing = activeJobs.get(input.roomId)
  if (existing?.running) return toProgress(existing, "progress", "歌单正在导入中")

  const importedIds = new Set(input.importedItemIds || [])
  const initialCount = importedIds.size
  const job: PlaylistImportJob = {
    roomId: input.roomId,
    link: input.link,
    total: input.items.length,
    parsedCount: initialCount,
    successCount: initialCount,
    failedCount: 0,
    failedTracks: [],
    addedCount: initialCount,
    running: true,
    cancelled: false,
    importedIds
  }

  activeJobs.set(input.roomId, job)
  broadcastProgress(
    job,
    "started",
    job.successCount > 0 ? `已加入 ${job.addedCount} 首，剩余歌曲后台加载中` : "正在导入歌单"
  )
  void runPlaylistImport(job, input.items)
  return toProgress(job, "started", "歌单已开始导入")
}

export function cancelPlaylistImport(roomId: string): RequestRes<PlaylistImportProgress> {
  const job = activeJobs.get(roomId)
  if (!job || !job.running) {
    return {
      code: "0000",
      showMsg: "当前房间没有正在运行的导入任务",
      data: {
        status: "cancelled",
        roomId,
        link: "",
        total: 0,
        parsedCount: 0,
        successCount: 0,
        failedCount: 0,
        addedCount: 0,
        message: "当前房间没有正在运行的导入任务"
      }
    }
  }

  job.cancelled = true
  job.running = false
  const progress = toProgress(job, "cancelled", `导入已取消：已加入 ${job.addedCount} 首，已解析 ${job.parsedCount}/${job.total}`)
  broadcastToRoom(roomId, {
    responseType: "PLAYLIST_IMPORT_PROGRESS",
    playlistImportProgress: progress
  })
  return {
    code: "0000",
    showMsg: "已取消导入任务",
    data: progress
  }
}

export function stopPlaylistImportForRoom(roomId: string): boolean {
  const job = activeJobs.get(roomId)
  if (!job) return false
  job.cancelled = true
  job.running = false
  activeJobs.delete(roomId)
  return true
}

export function getPlaylistImportProgress(roomId: string): PlaylistImportProgress | undefined {
  const job = activeJobs.get(roomId)
  if (!job) return undefined
  return toProgress(job, job.cancelled ? "cancelled" : "progress", job.cancelled ? "导入已取消" : "歌单正在导入中")
}

async function runPlaylistImport(job: PlaylistImportJob, items: QueueItem[]): Promise<void> {
  try {
    for (const item of items) {
      if (job.cancelled || !job.running) break
      if (job.importedIds.has(item.id)) continue

      const room = await roomRepo.get(job.roomId)
      if (!room || room.oState !== "OK") break
      if (roomHasQueueItem(room, item)) {
        job.importedIds.add(item.id)
        job.parsedCount += 1
        job.successCount += 1
        job.addedCount += 1
        broadcastProgress(job, "progress", progressMessage(job))
        continue
      }

      await sleep(randomDelay())
      if (job.cancelled || !job.running) break
      if (!await isRoomImportable(job.roomId)) break

      try {
        const content = await resolveQueueItemContent(item)
        if (job.cancelled || !job.running) break
        if (!await isRoomImportable(job.roomId)) break

        job.parsedCount += 1
        if (!content?.audioUrl) {
          recordImportFailure(job, item, "歌曲可能需要会员或版权受限", "play url empty")
          broadcastProgress(job, "progress", progressMessage(job))
          continue
        }

        const playable = toPlayableQueueItem(item, content)
        const appended = await appendQueueItem(job.roomId, playable)
        if (!await isRoomImportable(job.roomId)) break
        if (appended) {
          job.importedIds.add(item.id)
          job.successCount += 1
          job.addedCount += 1
          const latest = await roomRepo.get(job.roomId)
          if (latest?.queue) broadcastQueue(job.roomId, latest)
        } else {
          job.importedIds.add(item.id)
          job.successCount += 1
        }
        broadcastProgress(job, "progress", progressMessage(job))
      } catch (err) {
        job.parsedCount += 1
        recordImportFailure(job, item, normalizeImportFailureReason(err), err)
        broadcastProgress(job, "progress", progressMessage(job))
      }
    }

    if (!job.cancelled && await isRoomImportable(job.roomId)) {
      job.running = false
      broadcastProgress(job, "completed", `导入完成：成功 ${job.successCount} 首，失败 ${job.failedCount} 首`)
    }
  } finally {
    activeJobs.delete(job.roomId)
  }
}

async function appendQueueItem(roomId: string, item: QueueItem): Promise<boolean> {
  const room = await roomRepo.get(roomId)
  if (!room || room.oState !== "OK") return false

  const baseQueue: RoomQueue = normalizeQueue(room.queue)
    || { items: [contentToQueueItem(room.content)], currentIndex: 0, playMode: "sequence" }

  if (baseQueue.items.some(existing => sameQueueItem(existing, item))) return false

  const queue = reconcileQueueCurrent(baseQueue, { ...baseQueue, items: [...baseQueue.items, item] })

  await roomRepo.update(roomId, { queue })
  return true
}

function broadcastQueue(roomId: string, room: Room): void {
  broadcastToRoom(roomId, {
    responseType: "NEW_STATUS",
    roomStatus: {
      roomId,
      content: room.content,
      playStatus: room.playStatus,
      speedRate: room.speedRate,
      contentStamp: room.contentStamp,
      operateStamp: room.operateStamp,
      operator: room.operator,
      queue: room.queue,
      currentIndex: room.queue?.currentIndex,
      currentItemId: room.queue?.currentItemId,
      playMode: room.queue?.playMode
    }
  })
}

function broadcastProgress(job: PlaylistImportJob, status: PlaylistImportProgress["status"], message: string): void {
  broadcastToRoom(job.roomId, {
    responseType: "PLAYLIST_IMPORT_PROGRESS",
    playlistImportProgress: toProgress(job, status, message)
  })
}

async function isRoomImportable(roomId: string): Promise<boolean> {
  const room = await roomRepo.get(roomId)
  return Boolean(room && room.oState === "OK")
}

function toProgress(job: PlaylistImportJob, status: PlaylistImportProgress["status"], message: string): PlaylistImportProgress {
  return {
    status,
    roomId: job.roomId,
    link: job.link,
    total: job.total,
    parsedCount: Math.min(job.parsedCount, job.total),
    successCount: job.successCount,
    failedCount: job.failedCount,
    addedCount: job.addedCount,
    message,
    ...(job.failedTracks.length ? { failedTracks: job.failedTracks } : {})
  }
}

function progressMessage(job: PlaylistImportJob): string {
  return `已加入 ${job.addedCount} 首，已解析 ${Math.min(job.parsedCount, job.total)}/${job.total}，失败 ${job.failedCount} 首`
}

function contentToQueueItem(content: ContentData): QueueItem {
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

function sameQueueItem(a: QueueItem, b: QueueItem): boolean {
  if (a.id && b.id && a.id === b.id) return true
  if (a.sourceType && b.sourceType && a.resourceId && b.resourceId) {
    return a.sourceType === b.sourceType && a.resourceId === b.resourceId
  }
  return Boolean(a.audioUrl && b.audioUrl && a.audioUrl === b.audioUrl)
}

function roomHasQueueItem(room: Room, item: QueueItem): boolean {
  return Boolean(room.queue?.items.some(existing => sameQueueItem(existing, item)))
}

function recordImportFailure(job: PlaylistImportJob, item: QueueItem, reason: string, rawReason?: unknown): void {
  job.failedCount += 1
  if (job.failedTracks.length >= MAX_FAILED_TRACK_DETAILS) return

  job.failedTracks.push({
    title: cleanFailureText(item.title),
    artist: cleanFailureText(item.artist),
    source: cleanFailureText(item.linkUrl || item.resourceId || item.sourceType || item.id),
    reason: cleanFailureText(reason) || "未知错误",
    rawReason: getRawReason(rawReason)
  })
}

function normalizeImportFailureReason(error: unknown, fallback: string = "未知错误"): string {
  const raw = (getRawReason(error) || "").toLowerCase()
  if (!raw) return fallback
  if (/econn|etimedout|timeout|network|socket|enotfound|eai_again|axios|fetch/.test(raw)) {
    return "网络请求失败"
  }
  if (/unsupported|not supported|platform|暂不支持/.test(raw)) {
    return "平台暂不支持"
  }
  if (/parse|invalid url|invalid link|无法解析|解析失败/.test(raw)) {
    return "无法解析歌曲链接"
  }
  if (/eacces|enospc|write|save|保存/.test(raw)) {
    return "服务器保存失败"
  }
  return fallback
}

function getRawReason(error: unknown): string | undefined {
  const raw = rawReasonText(error)
  if (!raw) return undefined
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_RAW_REASON_LENGTH)
}

function rawReasonText(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message || error.name
  if (typeof error === "object") {
    const data = error as Record<string, unknown>
    const parts = [data.code, data.message, data.status, data.statusText]
      .map(value => typeof value === "string" || typeof value === "number" ? String(value) : "")
      .filter(Boolean)
    if (parts.length) return parts.join(" ")
  }
  return String(error)
}

function cleanFailureText(value?: string): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  return text || undefined
}

function randomDelay(): number {
  return IMPORT_DELAY_MIN_MS + Math.floor(Math.random() * (IMPORT_DELAY_MAX_MS - IMPORT_DELAY_MIN_MS + 1))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
