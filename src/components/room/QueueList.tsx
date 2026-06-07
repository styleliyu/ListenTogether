import type { PageData, QueueItem } from "../../types"
import PlaylistImportPanel from "./PlaylistImportPanel"

interface QueueListProps {
  pageData: PageData
  showFailureDetails: boolean
  canControlPlayback: boolean
  canManageQueue: boolean
  canAppendQueueByLink: boolean
  onAppendQueueByLink: () => void
  onQueueAdvance: (direction: "next" | "prev") => void
  onPlayModeChange: () => void
  onQueueItemTap: (index: number) => void
  onQueueRemoveItem: (item: QueueItem) => void
  onQueueSkipCurrent: () => void
  onQueuePlayNext: (item: QueueItem) => void
  onCancelPlaylistImport: () => void
  onTogglePlaylistImportPanel: () => void
  onToggleFailureDetails: () => void
}

export default function QueueList({
  pageData,
  showFailureDetails,
  canControlPlayback,
  canManageQueue,
  canAppendQueueByLink,
  onAppendQueueByLink,
  onQueueAdvance,
  onPlayModeChange,
  onQueueItemTap,
  onQueueRemoveItem,
  onQueueSkipCurrent,
  onQueuePlayNext,
  onCancelPlaylistImport,
  onTogglePlaylistImportPanel,
  onToggleFailureDetails,
}: QueueListProps) {
  const queue = pageData.queue
  if (!queue?.items?.length) return null

  const playModeText = queue.playMode === "shuffle" ? "随机" : queue.playMode === "single" ? "单曲循环" : "顺序"
  const currentNumber = Math.min((queue.currentIndex || 0) + 1, queue.items.length)

  const isCurrent = (index: number, itemId: string) => {
    if (queue.currentItemId) return queue.currentItemId === itemId
    return index === queue.currentIndex
  }

  return (
    <div className="room-queue">
      <div className="queue-head">
        <div>
          <h2>播放队列</h2>
          <p>{currentNumber} / {queue.items.length}</p>
        </div>
        <div className="queue-actions">
          <button type="button" disabled={!canAppendQueueByLink} onClick={onAppendQueueByLink}>添加歌曲/歌单</button>
          <button type="button" disabled={!canControlPlayback} onClick={() => onQueueAdvance("prev")}>上一首</button>
          <button type="button" disabled={!canControlPlayback} onClick={() => onQueueAdvance("next")}>下一首</button>
          <button type="button" disabled={!canControlPlayback} onClick={onPlayModeChange}>{playModeText}</button>
        </div>
      </div>

      <PlaylistImportPanel
        pageData={pageData}
        showFailureDetails={showFailureDetails}
        onTogglePanel={onTogglePlaylistImportPanel}
        onCancel={onCancelPlaylistImport}
        onToggleFailureDetails={onToggleFailureDetails}
      />

      <div className="queue-list">
        {queue.items.map((item, index) => {
          const current = isCurrent(index, item.id)
          return (
            <div key={`${item.id}-${index}`} className={`queue-item ${current ? "queue-item_active" : ""}`}>
              <button className="queue-item__main" type="button" disabled={!canControlPlayback} onClick={() => onQueueItemTap(index)}>
                <span className="queue-index">{index + 1}</span>
                <span className="queue-title">{item.title}</span>
                <span className="queue-artist">{item.artist}</span>
              </button>
              <div className="queue-item__actions">
                {current && <span className="queue-item__badge">当前播放</span>}
                {current ? (
                  <button className="queue-item__mini" type="button" disabled={!canManageQueue} onClick={onQueueSkipCurrent}>跳过</button>
                ) : (
                  <button className="queue-item__mini" type="button" disabled={!canManageQueue} onClick={() => onQueuePlayNext(item)}>下首播放</button>
                )}
                <button className="queue-item__mini queue-item__mini_danger" type="button" disabled={!canManageQueue} onClick={() => onQueueRemoveItem(item)}>删除</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
