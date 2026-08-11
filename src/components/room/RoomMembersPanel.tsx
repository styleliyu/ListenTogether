import type { PageParticipant } from "../../types"

interface RoomMembersPanelProps {
  participants: PageParticipant[]
  ownerGuestId?: string
  onManage: () => void
  onEditMyName: (participant: PageParticipant) => void
}

export default function RoomMembersPanel({ participants, ownerGuestId, onManage, onEditMyName }: RoomMembersPanelProps) {
  if (!participants.length) return null

  return (
    <section className="room-members" aria-label="房间成员">
      <div className="room-section-head">
        <div>
          <div className="room-panel-kicker"><span aria-hidden="true" /> LISTENERS</div>
          <h2>正在听的有</h2>
          <p>{participants.length} 位成员在线</p>
        </div>
        <button className="room-ui-btn room-ui-btn_secondary room-ui-btn_sm" type="button" onClick={onManage}>管理</button>
      </div>
      <div className="room-participants">
        {participants.map(item => {
          const isOwner = Boolean(ownerGuestId && item.guestId === ownerGuestId)
          const avatarText = item.nickName.trim().slice(0, 1) || "听"
          return (
          <div className={`room-participant ${item.isMe ? "room-participant_me" : ""}`} key={item.guestId}>
            <button
              className={`rp-nickName ${item.isMe ? "rp-nickName_pointer" : ""}`}
              type="button"
              aria-label={item.isMe ? `修改我的昵称，当前为 ${item.nickName}` : `${item.nickName}，${isOwner ? "房主" : "成员"}`}
              onClick={() => onEditMyName(item)}
            >
              <span className="rp-member-avatar" aria-hidden="true">{avatarText}</span>
              <span className="rp-nickName__copy">
                <span>{item.nickName}</span>
                {item.isMe && <span className="rp-nickName-icon">我</span>}
              </span>
            </button>
            <div className="rp-member-meta">
              <span className={`rp-role ${isOwner ? "rp-role_owner" : ""}`}>{isOwner ? "房主" : "成员"}</span>
              <span className="rp-enter-time">{item.enterStr ? `${item.enterStr}进入` : "在线"}</span>
            </div>
          </div>
          )
        })}
      </div>
    </section>
  )
}
