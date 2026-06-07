import { useMemo, useRef, useState } from "react"
import images from "../../images"
import ListeningLoader from "../../components/ListeningLoader"
import PtButton from "../../components/PtButton"
import RoomHeader from "../../components/room/RoomHeader"
import PlayerPanel from "../../components/room/PlayerPanel"
import QueueList from "../../components/room/QueueList"
import RoomMembersPanel from "../../components/room/RoomMembersPanel"
import RoomManagePopup from "../../components/room/RoomManagePopup"
import RoomSharePopup from "../../components/room/RoomSharePopup"
import { buildRoomShareUrl } from "../../services/share"
import { useRoomPage } from "../../hooks/useRoomPage"
import type { PageParticipant } from "../../types"
import "./roomPage.css"

export default function RoomPage() {
  const playerEl = useRef<HTMLDivElement | null>(null)
  const {
    pageData,
    toHome,
    toContact,
    toEditMyName,
    onQueueItemTap,
    onQueueAdvance,
    onQueueRemoveItem,
    onQueueSkipCurrent,
    onQueuePlayNext,
    onPlayModeChange,
    onAppendQueueByLink,
    onCancelPlaylistImport,
    onTogglePlaylistImportPanel,
    onRoomPermissionChange,
    onTransferOwner,
    onRoomNameChange,
    onDeleteRoom,
  } = useRoomPage(playerEl)

  const [showManagePopup, setShowManagePopup] = useState(false)
  const [showSharePopup, setShowSharePopup] = useState(false)
  const [showFailureDetails, setShowFailureDetails] = useState(false)

  const roomDisplayName = useMemo(() => pageData.roomName?.trim() || `一起听房间 ${pageData.roomId}`, [pageData.roomId, pageData.roomName])
  const canControlPlayback = pageData.amIOwner || pageData.permissions.memberCanControlPlayback
  const canManageQueue = pageData.amIOwner || pageData.permissions.memberCanManageQueue
  const canImportPlaylist = pageData.amIOwner || pageData.permissions.memberCanImportPlaylist
  const canAppendQueueByLink = canManageQueue || canImportPlaylist
  const shareUrl = pageData.roomId ? buildRoomShareUrl(pageData.roomId) : ""
  const hasLink = Boolean(pageData.content?.linkUrl)

  const onEditMyName = (participant: PageParticipant) => {
    if (!participant.isMe) return
    const nextName = window.prompt("请输入昵称", participant.nickName)
    if (nextName && nextName !== participant.nickName) void toEditMyName(nextName)
  }

  const onTapShowMore = () => {
    if (hasLink && pageData.content?.linkUrl) {
      window.open(pageData.content.linkUrl, "_blank")
      return
    }
  }

  return (
    <>
      <div className="page room-page">
        <div className="crawler-hidden">
          <img src={images.APP_LOGO_COS} height="132" width="132" />
          <p>{pageData.content?.title || (pageData.content?.seriesName ? `邀请你一起听《${pageData.content.seriesName}》` : "邀请你一起听！")}</p>
        </div>

        {pageData.state <= 2 && (
          <div className="page-full">
            <ListeningLoader />
            <div className="pf-text"><span>{pageData.state === 1 ? "正在进入房间.." : "正在连接播放器.."}</span></div>
          </div>
        )}

        <div className="page-container room-container" style={{ display: pageData.state === 3 ? undefined : "none" }}>
          <RoomHeader title={roomDisplayName} />
          <PlayerPanel playerRef={playerEl} />

          <QueueList
            pageData={pageData}
            showFailureDetails={showFailureDetails}
            canControlPlayback={canControlPlayback}
            canManageQueue={canManageQueue}
            canAppendQueueByLink={canAppendQueueByLink}
            onAppendQueueByLink={onAppendQueueByLink}
            onQueueAdvance={onQueueAdvance}
            onPlayModeChange={onPlayModeChange}
            onQueueItemTap={onQueueItemTap}
            onQueueRemoveItem={onQueueRemoveItem}
            onQueueSkipCurrent={onQueueSkipCurrent}
            onQueuePlayNext={onQueuePlayNext}
            onCancelPlaylistImport={onCancelPlaylistImport}
            onTogglePlaylistImportPanel={onTogglePlaylistImportPanel}
            onToggleFailureDetails={() => setShowFailureDetails(value => !value)}
          />

          <div className="room-virtual-one" />

          <RoomMembersPanel
            participants={pageData.participants}
            onManage={() => setShowManagePopup(true)}
            onEditMyName={onEditMyName}
          />

          <div className="room-btns">
            <button className="room-btn" type="button" onClick={() => { if (window.confirm("确定要离开吗？")) toHome() }}>
              <span>离开</span>
            </button>
            <button className="room-btn room-btn-main" type="button" onClick={() => setShowSharePopup(true)}>
              <span>分享</span>
            </button>
          </div>

          {pageData.content?.title && pageData.content?.description && (
            <div className="room-title-desc">
              <div className="room-podcast-title"><span>{pageData.content.title}</span></div>
              <div className="room-desc-box">
                <div className={`room-description ${pageData.showMoreBox ? "room-desc-limited" : ""} ${hasLink ? "room-desc_pointer" : ""}`} onClick={!pageData.showMoreBox ? onTapShowMore : undefined}>
                  <span>{pageData.content.description}</span>
                </div>
                {pageData.showMoreBox && (
                  <button className="room-show-more" type="button" onClick={onTapShowMore}>
                    <span className="room-show-more-text">{hasLink ? "查看原文" : "展开更多"}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="room-virtual-two" />
        </div>

        {pageData.state >= 11 && (
          <div className="page-full">
            <img src={pageData.state === 17 ? images.IMG_DOOR : images.IMG_PLACEHOLDER} className="pf-no-data-img" />
            <div className="pf-no-data-box">
              <h1>{stateTitle(pageData.state)}</h1>
              {stateMessage(pageData.state) && <p>{stateMessage(pageData.state)}</p>}
            </div>
            <div className="pf-no-data-btns">
              <PtButton text={retryText(pageData.state)} type={contactText(pageData.state) ? "main" : "other"} onClick={pageData.state === 11 || pageData.state === 12 || pageData.state === 14 || pageData.state === 15 ? toHome : () => window.location.reload()} />
              {contactText(pageData.state) && <PtButton className="pf-ndb-other" text={contactText(pageData.state)} type="other" onClick={toContact} />}
            </div>
          </div>
        )}
      </div>

      <RoomManagePopup
        show={showManagePopup}
        permissions={pageData.permissions}
        roomName={pageData.roomName || ""}
        isPersistent={Boolean(pageData.isPersistent)}
        amIOwner={pageData.amIOwner}
        roomRole={pageData.roomRole}
        participants={pageData.participants}
        onClose={() => setShowManagePopup(false)}
        onPermissionChange={onRoomPermissionChange}
        onTransferOwner={onTransferOwner}
        onRoomNameChange={onRoomNameChange}
        onDeleteRoom={onDeleteRoom}
      />
      <RoomSharePopup
        show={showSharePopup}
        shareUrl={shareUrl}
        roomName={pageData.roomName || ""}
        roomId={pageData.roomId}
        isPersistent={Boolean(pageData.isPersistent)}
        onClose={() => setShowSharePopup(false)}
      />
    </>
  )
}

function stateTitle(state: number): string {
  if (state === 11) return "链接已过期"
  if (state === 12) return "查无该房间"
  if (state === 13) return "网络不佳"
  if (state === 14) return "拒绝访问"
  if (state === 15) return "房间人数已满"
  if (state === 16) return "长时间未操作"
  if (state === 17) return "房门外"
  if (state === 18) return "连接异常"
  if (state === 19) return "未知的异常"
  return "未知的错误"
}

function stateMessage(state: number): string {
  if (state === 13 || state === 20) return "请检查网络状态；\n如果重新尝试仍无改善，请联系开发者。"
  if (state === 17) return "已超过 5 分钟闲置；\n你似乎游走到房门外啦！"
  if (state === 18) return "你的连接似乎已断开"
  if (state === 19) return "建议关闭后重新打开。"
  return ""
}

function retryText(state: number): string {
  if (state === 11 || state === 12 || state === 14 || state === 15) return "回首页"
  if (state === 13 || state === 16 || state === 17 || state === 18 || state === 19) return "重新进入"
  return "重新尝试"
}

function contactText(state: number): string {
  return state === 13 || state === 18 || state === 19 || state === 20 ? "联系开发者" : ""
}
