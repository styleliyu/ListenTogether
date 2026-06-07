import { useEffect, useMemo, useState } from "react"
import PtButton from "../PtButton"
import type { PageParticipant, RoomPermissionConfig, RoomRole } from "../../types"

interface RoomManagePopupProps {
  show: boolean
  permissions: RoomPermissionConfig
  roomName: string
  isPersistent: boolean
  amIOwner: boolean
  roomRole: RoomRole
  participants: PageParticipant[]
  onClose: () => void
  onPermissionChange: (key: keyof RoomPermissionConfig, checked: boolean) => void
  onTransferOwner: (targetGuestId: string) => void
  onRoomNameChange: (roomName: string) => void
  onDeleteRoom: () => void
}

export default function RoomManagePopup({
  show,
  permissions,
  roomName,
  isPersistent,
  amIOwner,
  roomRole,
  participants,
  onClose,
  onPermissionChange,
  onTransferOwner,
  onRoomNameChange,
  onDeleteRoom,
}: RoomManagePopupProps) {
  const [roomNameDraft, setRoomNameDraft] = useState(roomName)
  const [transferGuestId, setTransferGuestId] = useState("")
  const transferCandidates = useMemo(() => participants.filter(item => !item.isMe), [participants])

  useEffect(() => setRoomNameDraft(roomName), [roomName])
  useEffect(() => {
    if (show) setTransferGuestId("")
  }, [show])

  return (
    <div className={`rmp-container ${show ? "rmp-container_show" : ""}`} onClick={onClose}>
      <div className="rmp-box" onClick={event => event.stopPropagation()}>
        <div className="rmp-first-bar">
          <div className="rmpf-title">管理</div>
        </div>
        <div className="rmp-role">
          <span>当前身份</span>
          <strong>{roomRole === "owner" ? "房主" : "普通成员"}</strong>
        </div>

        {amIOwner && (
          <>
            <PermissionRow
              label="允许普通成员控制播放"
              checked={permissions.memberCanControlPlayback}
              onChange={checked => onPermissionChange("memberCanControlPlayback", checked)}
            />
            <PermissionRow
              label="允许普通成员管理队列"
              checked={permissions.memberCanManageQueue}
              onChange={checked => onPermissionChange("memberCanManageQueue", checked)}
            />
            <PermissionRow
              label="允许普通成员导入歌单"
              checked={permissions.memberCanImportPlaylist}
              onChange={checked => onPermissionChange("memberCanImportPlaylist", checked)}
            />
          </>
        )}

        {isPersistent && (
          <div className="rmp-room-name">
            <div className="rmpb-hd"><span>常驻房间名称</span></div>
            <div className="rmp-room-name__body">
              <input value={roomNameDraft} maxLength={30} placeholder="输入房间名称" onChange={event => setRoomNameDraft(event.target.value)} />
              {amIOwner && <button type="button" onClick={() => onRoomNameChange(roomNameDraft)}>保存</button>}
            </div>
          </div>
        )}

        {amIOwner && transferCandidates.length > 0 && (
          <div className="rmp-transfer">
            <div className="rmpb-hd"><span>转让房主</span></div>
            <div className="rmp-transfer__body">
              <select value={transferGuestId} onChange={event => setTransferGuestId(event.target.value)}>
                <option value="">选择成员</option>
                {transferCandidates.map(item => <option key={item.guestId} value={item.guestId}>{item.nickName}</option>)}
              </select>
              <button type="button" disabled={!transferGuestId} onClick={() => onTransferOwner(transferGuestId)}>转让</button>
            </div>
          </div>
        )}

        {isPersistent && amIOwner && (
          <div className="rmp-danger">
            <button type="button" onClick={onDeleteRoom}>删除常驻房间</button>
          </div>
        )}

        <div className="rmp-btn">
          <PtButton text="关闭" type="other" onClick={onClose} />
        </div>
      </div>
    </div>
  )
}

function PermissionRow({ label, checked, onChange }: { label: string, checked: boolean, onChange: (checked: boolean) => void }) {
  return (
    <label className="rmp-bar">
      <div className="rmpb-hd"><span>{label}</span></div>
      <div className="rmpb-footer">
        <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      </div>
    </label>
  )
}
