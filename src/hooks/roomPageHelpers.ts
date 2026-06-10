import type { ContentData, PageState, QueueItem, RoomQueue, RoomStatus } from "../types"

export interface RoomStatusClassification {
  trackChanged: boolean
  playbackStatusChanged: boolean
}

export function buildPlaybackSignature(status: RoomStatus, content?: ContentData, queue?: RoomQueue): string {
  const itemById = queue?.currentItemId ? queue.items.find(item => item.id === queue.currentItemId) : undefined
  const currentItem = itemById || queue?.items?.[queue.currentIndex]
  const audioUrl = currentItem?.audioUrl || content?.audioUrl || ""
  const id = queue?.currentItemId || currentItem?.id || `${content?.sourceType || "audio"}:${content?.linkUrl || audioUrl}`
  return [id, audioUrl, status.playStatus, status.contentStamp, status.operateStamp].join("|")
}

export function enterResToErrState(code?: string): PageState | null {
  if (!code) return 13
  if (code === "0000") return null
  if (code === "E4004") return 12
  if (code === "E4006") return 11
  if (code === "E4003") return 14
  if (code === "R0001") return 15
  return 20
}

export function contentToQueueItems(content: ContentData): QueueItem[] {
  if (content.queue?.items?.length) return content.queue.items
  return [{
    id: `${content.sourceType || "audio"}:${content.linkUrl || content.audioUrl}`,
    sourceType: content.sourceType || "audio",
    title: content.title || content.seriesName || "音频",
    artist: content.seriesName || "",
    imageUrl: content.imageUrl || "",
    linkUrl: content.linkUrl || "",
    audioUrl: content.audioUrl,
  }]
}
