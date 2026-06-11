import { memo, useCallback, useMemo, useState } from "react"
import type { PageData, QueueItem } from "../../types"
import PlaylistImportPanel from "./PlaylistImportPanel"

const INITIAL_VISIBLE_QUEUE_COUNT = 100
const QUEUE_VISIBLE_STEP = 100

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
  const queueItems = queue?.items || []
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_QUEUE_COUNT)
  const displayPlayMode = pageData.pendingPlayMode || queue?.playMode || "sequence"
  const playModeText = displayPlayMode === "shuffle" ? "随机" : displayPlayMode === "single" ? "单曲循环" : "顺序"
  const currentNumber = Math.min(((queue?.currentIndex || 0) + 1), queueItems.length)
  const effectiveVisibleCount = Math.min(queueItems.length, Math.max(visibleCount, currentNumber))
  const visibleItems = useMemo(
    () => queueItems.slice(0, effectiveVisibleCount),
    [effectiveVisibleCount, queueItems],
  )
  const hiddenCount = queueItems.length - effectiveVisibleCount
  const hasImportPanel = Boolean(pageData.playlistImportProgress || pageData.playlistImportMessage)

  const isCurrent = (index: number, itemId: string) => {
    if (queue?.currentItemId) return queue.currentItemId === itemId
    return index === queue?.currentIndex
  }

  const showMore = useCallback(() => {
    setVisibleCount(value => Math.min(queueItems.length, value + QUEUE_VISIBLE_STEP))
  }, [queueItems.length])

  const showAll = useCallback(() => {
    setVisibleCount(queueItems.length)
  }, [queueItems.length])

  const collapseList = useCallback(() => {
    setVisibleCount(INITIAL_VISIBLE_QUEUE_COUNT)
  }, [])

  if (!queue || queueItems.length < 1) {
    if (!hasImportPanel) return null
    return (
      <div className="room-queue">
        <div className="queue-head">
          <div>
            <h2>播放队列</h2>
            <p>暂无歌曲</p>
          </div>
          <div className="queue-actions">
            <button type="button" disabled={!canAppendQueueByLink} onClick={onAppendQueueByLink}>添加歌曲/歌单</button>
          </div>
        </div>
        <PlaylistImportPanel
          pageData={pageData}
          showFailureDetails={showFailureDetails}
          onTogglePanel={onTogglePlaylistImportPanel}
          onCancel={onCancelPlaylistImport}
          onToggleFailureDetails={onToggleFailureDetails}
        />
      </div>
    )
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
        {visibleItems.map((item, index) => {
          const current = isCurrent(index, item.id)
          return (
            <QueueItemRow
              key={item.id}
              item={item}
              index={index}
              current={current}
              canControlPlayback={canControlPlayback}
              canManageQueue={canManageQueue}
              onQueueItemTap={onQueueItemTap}
              onQueueRemoveItem={onQueueRemoveItem}
              onQueueSkipCurrent={onQueueSkipCurrent}
              onQueuePlayNext={onQueuePlayNext}
            />
          )
        })}
      </div>
      {(hiddenCount > 0 || effectiveVisibleCount > INITIAL_VISIBLE_QUEUE_COUNT) && (
        <div className="queue-list__more">
          {hiddenCount > 0 && <span>已显示 {effectiveVisibleCount} / {queue.items.length}</span>}
          <div className="queue-list__more-actions">
            {hiddenCount > 0 && <button type="button" onClick={showMore}>展开更多</button>}
            {hiddenCount > QUEUE_VISIBLE_STEP && <button type="button" onClick={showAll}>显示全部</button>}
            {effectiveVisibleCount > INITIAL_VISIBLE_QUEUE_COUNT && <button type="button" onClick={collapseList}>收起队列</button>}
          </div>
        </div>
      )}
    </div>
  )
}

interface QueueItemRowProps {
  item: QueueItem
  index: number
  current: boolean
  canControlPlayback: boolean
  canManageQueue: boolean
  onQueueItemTap: (index: number) => void
  onQueueRemoveItem: (item: QueueItem) => void
  onQueueSkipCurrent: () => void
  onQueuePlayNext: (item: QueueItem) => void
}

const QueueItemRow = memo(function QueueItemRow({
  item,
  index,
  current,
  canControlPlayback,
  canManageQueue,
  onQueueItemTap,
  onQueueRemoveItem,
  onQueueSkipCurrent,
  onQueuePlayNext,
}: QueueItemRowProps) {
  const tapItem = useCallback(() => onQueueItemTap(index), [index, onQueueItemTap])
  const removeItem = useCallback(() => onQueueRemoveItem(item), [item, onQueueRemoveItem])
  const playNext = useCallback(() => onQueuePlayNext(item), [item, onQueuePlayNext])

  return (
    <div className={`queue-item ${current ? "queue-item_active" : ""}`}>
      <button className="queue-item__main" type="button" disabled={!canControlPlayback} onClick={tapItem}>
        <span className="queue-index">{index + 1}</span>
        <span className="queue-title">{item.title}</span>
        <span className="queue-artist">{item.artist}</span>
      </button>
      <div className="queue-item__actions">
        {current && <span className="queue-item__badge">当前播放</span>}
        {current ? (
          <button className="queue-item__mini" type="button" disabled={!canManageQueue} onClick={onQueueSkipCurrent}>跳过</button>
        ) : (
          <button className="queue-item__mini" type="button" disabled={!canManageQueue} onClick={playNext}>下首播放</button>
        )}
        <button className="queue-item__mini queue-item__mini_danger" type="button" disabled={!canManageQueue} onClick={removeItem}>删除</button>
      </div>
    </div>
  )
})
