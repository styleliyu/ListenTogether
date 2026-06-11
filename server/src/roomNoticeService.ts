import crypto from "crypto"
import type { RoomNotice, RoomNoticeType } from "./types"

const MAX_ROOM_NOTICE_HISTORY = 50

const roomNoticeHistories = new Map<string, RoomNotice[]>()

interface AppendRoomNoticeInput {
  roomId: string
  type: RoomNoticeType
  content: string
  createdAt?: number
}

export function appendRoomNotice(input: AppendRoomNoticeInput): RoomNotice {
  const notice: RoomNotice = {
    id: createRoomNoticeId(),
    roomId: input.roomId,
    type: input.type,
    content: input.content.trim(),
    createdAt: input.createdAt || Date.now()
  }

  const history = roomNoticeHistories.get(input.roomId) || []
  history.push(notice)
  roomNoticeHistories.set(input.roomId, history.slice(-MAX_ROOM_NOTICE_HISTORY))
  return notice
}

export function getRoomNoticeHistory(roomId: string): RoomNotice[] {
  return [...(roomNoticeHistories.get(roomId) || [])]
}

export function clearRoomNoticeHistory(roomId: string): void {
  roomNoticeHistories.delete(roomId)
}

function createRoomNoticeId(): string {
  return crypto.randomBytes(12).toString("hex")
}
