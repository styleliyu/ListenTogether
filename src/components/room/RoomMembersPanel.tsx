import type { PageParticipant } from "../../types"

interface RoomMembersPanelProps {
  participants: PageParticipant[]
  onManage: () => void
  onEditMyName: (participant: PageParticipant) => void
}

export default function RoomMembersPanel({ participants, onManage, onEditMyName }: RoomMembersPanelProps) {
  if (!participants.length) return null

  return (
    <>
      <div className="room-listening">
        <div className="rl-title">正在听的有</div>
        <button className="rl-mini-btn" type="button" onClick={onManage}>管理</button>
      </div>
      <div className="room-participants">
        {participants.map(item => (
          <div className="room-participant" key={item.guestId}>
            <button
              className={`rp-nickName ${item.isMe ? "rp-nickName_pointer" : ""}`}
              type="button"
              onClick={() => onEditMyName(item)}
            >
              <span>{item.nickName}</span>
              {item.isMe && <span className="rp-nickName-icon">编辑</span>}
            </button>
            <div className="rp-enter-time"><span>{item.enterStr}进入</span></div>
          </div>
        ))}
      </div>
    </>
  )
}
