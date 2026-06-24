import type { PageData } from "../../types"

interface PlaylistImportPanelProps {
  pageData: PageData
  showFailureDetails: boolean
  onTogglePanel: () => void
  onCancel: () => void
  onToggleFailureDetails: () => void
}

export default function PlaylistImportPanel({
  pageData,
  showFailureDetails,
  onTogglePanel,
  onCancel,
  onToggleFailureDetails,
}: PlaylistImportPanelProps) {
  const progress = pageData.playlistImportProgress
  const showPanel = Boolean(progress || pageData.playlistImportMessage)
  if (!showPanel) return null

  const statusText = progress?.status === "completed"
    ? "已完成"
    : progress?.status === "cancelled"
      ? "已取消"
      : progress?.status === "failed"
        ? "导入失败"
        : "正在导入"
  const summary = progress
    ? progress.status === "completed"
      ? `导入完成：成功 ${progress.addedCount || 0} 首，失败 ${progress.failedCount || 0} 首`
      : progress.status === "cancelled"
        ? `已取消：已加入 ${progress.addedCount || 0} 首，失败 ${progress.failedCount || 0} 首`
        : progress.status === "failed"
          ? `导入失败：已加入 ${progress.addedCount || 0} 首，失败 ${progress.failedCount || 0} 首`
          : `导入中：已加入 ${progress.addedCount || 0} 首，已解析 ${progress.parsedCount || 0}/${progress.total || 0}，失败 ${progress.failedCount || 0} 首`
    : pageData.playlistImportMessage || ""
  const canCancel = progress?.status === "started" || progress?.status === "progress"
  const failedTracks = progress?.failedTracks || []
  const visibleFailedTracks = failedTracks.slice(0, 10)
  const hiddenCount = Math.max((progress?.failedCount || failedTracks.length) - visibleFailedTracks.length, 0)
  const total = progress?.total || 0
  const parsedCount = progress?.parsedCount || 0
  const progressPercent = total > 0 ? Math.min(100, Math.round((parsedCount / total) * 100)) : 0
  const statusClass = progress?.status || "message"
  const compactSummary = `成功 ${progress?.addedCount || 0} / 失败 ${progress?.failedCount || 0} / 总数 ${total}`

  if (pageData.playlistImportCollapsed) {
    return (
      <div className={`playlist-import-panel playlist-import-panel_collapsed playlist-import-panel_${statusClass}`}>
        <div className="playlist-import-panel__compact">
          <div className="playlist-import-panel__compact-main">
            <strong>歌单导入</strong>
            <span>{statusText}</span>
            <span>{compactSummary}</span>
          </div>
          <button className="playlist-import-panel__toggle" type="button" onClick={onTogglePanel}>
            展开
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`playlist-import-panel playlist-import-panel_${statusClass}`}>
      <div className="playlist-import-panel__head">
        <div className="playlist-import-panel__summary">
          <div className="playlist-import-panel__title">
            <h3>歌单导入</h3>
            <span>{statusText}</span>
          </div>
          <p>{summary}</p>
          <div className="playlist-import-panel__stats" aria-label="导入统计">
            <span>成功 {progress?.addedCount || 0}</span>
            <span>失败 {progress?.failedCount || 0}</span>
            <span>总数 {total}</span>
          </div>
        </div>
        <button className="playlist-import-panel__toggle" type="button" onClick={onTogglePanel}>
          收起
        </button>
        {canCancel && (
          <button
            className="playlist-import-panel__cancel"
            type="button"
            disabled={pageData.cancellingPlaylistImport}
            onClick={onCancel}
          >
            {pageData.cancellingPlaylistImport ? "取消中..." : "取消导入"}
          </button>
        )}
      </div>

      {!pageData.playlistImportCollapsed && (
        <>
          <div className="playlist-import-panel__progress" aria-label={`导入进度 ${progressPercent}%`}>
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="playlist-import-panel__grid">
            <span>状态：{statusText}</span>
            <span>已加入：{progress?.addedCount || 0} 首</span>
            <span>已解析：{progress?.parsedCount || 0} / {progress?.total || 0}</span>
            <span>失败：{progress?.failedCount || 0} 首</span>
          </div>

          {(progress?.failedCount || 0) > 0 && failedTracks.length > 0 && (
            <div className="playlist-import-panel__failures">
              <button className="playlist-import-panel__failure-toggle" type="button" onClick={onToggleFailureDetails}>
                {showFailureDetails ? "收起失败详情" : "查看失败详情"}
              </button>
              {showFailureDetails && (
                <div className="playlist-import-panel__failure-list">
                  {visibleFailedTracks.map((item, index) => (
                    <div key={`${item.source || item.title || "failed"}-${index}`} className="playlist-import-panel__failure-item">
                      <div className="playlist-import-panel__failure-main">{item.title || item.source || "未知歌曲"}</div>
                      {(item.artist || item.source) && <div className="playlist-import-panel__failure-sub">{item.artist || item.source}</div>}
                      <div className="playlist-import-panel__failure-reason">{item.reason || "未知错误"}</div>
                    </div>
                  ))}
                  {hiddenCount > 0 && <div className="playlist-import-panel__failure-more">还有 {hiddenCount} 条失败未展示。</div>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
