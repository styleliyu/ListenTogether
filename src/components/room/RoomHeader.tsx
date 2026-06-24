interface RoomHeaderProps {
  title: string
  roomRole: "owner" | "member"
  isPersistent: boolean
  participantCount: number
  onManage: () => void
  onShare: () => void
  onLeave: () => void
}

export default function RoomHeader({
  title,
  roomRole,
  isPersistent,
  participantCount,
  onManage,
  onShare,
  onLeave,
}: RoomHeaderProps) {
  return (
    <header className="room-header">
      <div className="room-header__main">
        <div className="room-header__eyebrow">
          <span>{isPersistent ? "常驻房间" : "临时房间"}</span>
          <span>{roomRole === "owner" ? "房主" : "成员"}</span>
          <span>{participantCount} 人在线</span>
        </div>
        <h1>{title}</h1>
      </div>
      <div className="room-header__actions">
        <button className="room-ui-btn room-ui-btn_ghost" type="button" onClick={onLeave}>离开</button>
        <button className="room-ui-btn room-ui-btn_secondary" type="button" onClick={onManage}>管理</button>
        <button className="room-ui-btn room-ui-btn_primary" type="button" onClick={onShare}>分享</button>
      </div>
    </header>
  )
}
