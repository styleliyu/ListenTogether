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
          <h2>正在听的有</h2>
          <p>{participants.length} 位成员在线</p>
        </div>
        <button className="room-ui-btn room-ui-btn_secondary room-ui-btn_sm" type="button" onClick={onManage}>管理</button>
      </div>
      <div className="room-participants">
        {participants.map(item => {
          const isOwner = Boolean(ownerGuestId && item.guestId === ownerGuestId)
          return (
          <div className={`room-participant ${item.isMe ? "room-participant_me" : ""}`} key={item.guestId}>
            <button
              className={`rp-nickName ${item.isMe ? "rp-nickName_pointer" : ""}`}
              type="button"
              onClick={() => onEditMyName(item)}
            >
              <span>{item.nickName}</span>
              {item.isMe && <span className="rp-nickName-icon">我</span>}
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
