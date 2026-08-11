import { useEffect, useMemo, useState } from "react"
import PtButton from "../PtButton"
import { copyShareLink, createRoomQrCode, nativeShareOrCopy } from "../../services/share"
import useRoomModal from "./useRoomModal"

interface RoomSharePopupProps {
  show: boolean
  shareUrl: string
  roomName: string
  roomId: string
  isPersistent: boolean
  onClose: () => void
}

export default function RoomSharePopup({
  show,
  shareUrl,
  roomName,
  roomId,
  isPersistent,
  onClose,
}: RoomSharePopupProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [qrCodeError, setQrCodeError] = useState("")
  const { dialogRef, initialFocusRef } = useRoomModal(show, onClose)
  const roomTitle = roomName.trim() || `一起听房间 ${roomId}`
  const roomDesc = isPersistent ? "常驻房间二维码长期有效，删除房间后失效。" : "临时房间二维码在房间未删除前可用。"
  const nativeShareData = useMemo<ShareData>(() => ({
    title: `${roomTitle} 邀请你一起听`,
    text: roomDesc,
    url: shareUrl,
  }), [roomDesc, roomTitle, shareUrl])

  useEffect(() => {
    setQrCodeUrl("")
    setQrCodeError("")
    if (!show || !shareUrl) return
    createRoomQrCode(shareUrl)
      .then(setQrCodeUrl)
      .catch(() => setQrCodeError("二维码生成失败，请复制链接分享。"))
  }, [shareUrl, show])

  const onCopyLink = async () => {
    const copied = await copyShareLink(shareUrl)
    window.alert(copied ? "房间链接已复制到剪贴板。" : "复制失败，请手动复制房间链接。")
  }

  const onNativeShare = async () => {
    const done = await nativeShareOrCopy(nativeShareData)
    if (!done) window.alert("请手动复制房间链接。")
  }

  if (!show) return null

  return (
    <div className="rsp-container rsp-container_show" onPointerDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        className="rsp-box"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-share-title"
        aria-describedby="room-share-description"
        tabIndex={-1}
      >
        <div className="rsp-head">
          <div>
            <div className="room-panel-kicker"><span aria-hidden="true" /> INVITE LISTENERS</div>
            <h2 id="room-share-title">分享房间</h2>
            <p id="room-share-description">{roomDesc}</p>
          </div>
          <button className="rsp-close room-dialog-close" ref={initialFocusRef} type="button" aria-label="关闭分享房间" onClick={onClose}>×</button>
        </div>

        <div className="rsp-qr" aria-live="polite">
          {qrCodeUrl ? <img src={qrCodeUrl} alt="房间二维码" /> : <div className="rsp-qr-placeholder"><span>{qrCodeError || "正在生成二维码..."}</span></div>}
        </div>

        <div className="rsp-link" aria-label="房间分享链接"><span>{shareUrl}</span></div>

        <div className="rsp-actions">
          <PtButton text="复制链接" type="other" onClick={onCopyLink} />
          <PtButton text="分享房间" onClick={onNativeShare} />
        </div>
      </div>
    </div>
  )
}
