import { useEffect, useMemo, useState } from "react"
import PtButton from "../PtButton"
import { copyShareLink, createRoomQrCode, nativeShareOrCopy } from "../../services/share"

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

  return (
    <div className={`rsp-container ${show ? "rsp-container_show" : ""}`} onClick={onClose}>
      <div className="rsp-box" onClick={event => event.stopPropagation()}>
        <div className="rsp-head">
          <div>
            <h2>分享房间</h2>
            <p>{roomDesc}</p>
          </div>
          <button className="rsp-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="rsp-qr">
          {qrCodeUrl ? <img src={qrCodeUrl} alt="房间二维码" /> : <div className="rsp-qr-placeholder"><span>{qrCodeError || "正在生成二维码..."}</span></div>}
        </div>

        <div className="rsp-link"><span>{shareUrl}</span></div>

        <div className="rsp-actions">
          <PtButton text="复制链接" type="other" onClick={onCopyLink} />
          <PtButton text="分享房间" onClick={onNativeShare} />
        </div>
      </div>
    </div>
  )
}
