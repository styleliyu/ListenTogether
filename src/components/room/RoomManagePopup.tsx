import { useEffect, useMemo, useState } from "react"
import PtButton from "../PtButton"
import type { PageParticipant, RoomPermissionConfig, RoomRole } from "../../types"
import useRoomModal from "./useRoomModal"

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
  const { dialogRef, initialFocusRef } = useRoomModal(show, onClose)

  useEffect(() => setRoomNameDraft(roomName), [roomName])
  useEffect(() => {
    if (show) setTransferGuestId("")
  }, [show])

  if (!show) return null

  return (
    <div className="rmp-container rmp-container_show" onPointerDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        className="rmp-box"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-manage-title"
        aria-describedby="room-manage-description"
        tabIndex={-1}
      >
        <div className="rmp-first-bar">
          <div>
            <div className="room-panel-kicker"><span aria-hidden="true" /> ROOM CONTROL</div>
            <div className="rmpf-title" id="room-manage-title">房间管理</div>
            <p id="room-manage-description">在不打断共同收听的前提下，调整成员权限与房间信息。</p>
          </div>
          <button className="room-dialog-close" ref={initialFocusRef} type="button" aria-label="关闭房间管理" onClick={onClose}>×</button>
        </div>
        <div className="rmp-role">
          <span>当前身份</span>
          <strong>{roomRole === "owner" ? "房主" : "普通成员"}</strong>
        </div>

        {amIOwner && (
          <section className="rmp-section">
            <div className="rmp-section__head">
              <h3>成员权限</h3>
              <p>这些设置会影响普通成员在房间内可执行的操作。</p>
            </div>
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
          </section>
        )}

        {isPersistent && (
          <section className="rmp-section rmp-room-name">
            <div className="rmp-section__head">
              <h3>常驻房间名称</h3>
              <p>名称会显示在房间页和分享入口。</p>
            </div>
            <div className="rmp-room-name__body">
              <label className="room-field-label" htmlFor="room-name-draft">房间名称</label>
              <input id="room-name-draft" value={roomNameDraft} maxLength={30} placeholder="输入房间名称" aria-describedby="room-name-count" onChange={event => setRoomNameDraft(event.target.value)} />
              {amIOwner && <button type="button" onClick={() => onRoomNameChange(roomNameDraft)}>保存</button>}
            </div>
            <div className="rmp-field-note" id="room-name-count">{roomNameDraft.length}/30</div>
          </section>
        )}

        {amIOwner && transferCandidates.length > 0 && (
          <section className="rmp-section rmp-transfer">
            <div className="rmp-section__head">
              <h3>转让房主</h3>
              <p>转让后，对方将拥有房间管理权限。</p>
            </div>
            <div className="rmp-transfer__body">
              <label className="room-field-label" htmlFor="room-owner-transfer">新房主</label>
              <select id="room-owner-transfer" value={transferGuestId} onChange={event => setTransferGuestId(event.target.value)}>
                <option value="">选择成员</option>
                {transferCandidates.map(item => <option key={item.guestId} value={item.guestId}>{item.nickName}</option>)}
              </select>
              <button type="button" disabled={!transferGuestId} onClick={() => onTransferOwner(transferGuestId)}>转让</button>
            </div>
          </section>
        )}

        {isPersistent && amIOwner && (
          <section className="rmp-section rmp-danger">
            <div className="rmp-section__head">
              <h3>危险操作</h3>
              <p>删除后，常驻房间入口将失效。</p>
            </div>
            <button type="button" onClick={onDeleteRoom}>删除常驻房间</button>
          </section>
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
        <input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} />
      </div>
    </label>
  )
}
