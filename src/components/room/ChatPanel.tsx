import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { ChatMessage, PageParticipant, RoomNotice } from "../../types"

const MAX_CHAT_CONTENT_LENGTH = 300

interface ChatPanelProps {
  messages: ChatMessage[]
  roomNotices: RoomNotice[]
  participants: PageParticipant[]
  chatError?: string
  onSendMessage: (content: string) => boolean
  onClearError: () => void
}

type ChatEntry =
  | { entryType: "chat"; message: ChatMessage; createdAt: number }
  | { entryType: "notice"; notice: RoomNotice; createdAt: number }

const ChatPanel = memo(function ChatPanel({
  messages,
  roomNotices,
  participants,
  chatError,
  onSendMessage,
  onClearError,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const [localError, setLocalError] = useState("")
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const myGuestId = useMemo(() => participants.find(item => item.isMe)?.guestId || "", [participants])
  const entries = useMemo<ChatEntry[]>(() => [
    ...messages.map(message => ({ entryType: "chat" as const, message, createdAt: message.createdAt })),
    ...roomNotices.map(notice => ({ entryType: "notice" as const, notice, createdAt: notice.createdAt })),
  ].sort((a, b) => a.createdAt - b.createdAt).slice(-80), [messages, roomNotices])
  const charCount = draft.trim().length
  const errorText = localError || chatError || ""

  useEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return
    messageList.scrollTop = messageList.scrollHeight
  }, [entries.length])

  const submit = () => {
    const content = draft.trim()
    if (!content) {
      setLocalError("消息不能为空")
      return
    }
    if (content.length > MAX_CHAT_CONTENT_LENGTH) {
      setLocalError(`消息不能超过 ${MAX_CHAT_CONTENT_LENGTH} 个字符`)
      return
    }

    setLocalError("")
    onClearError()
    if (onSendMessage(content)) setDraft("")
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  return (
    <section className="room-chat" aria-label="房间聊天与动态">
      <div className="room-chat__head">
        <div>
          <h2>聊天与动态</h2>
          <p>{messages.length > 0 || roomNotices.length > 0 ? `聊天 ${messages.length} 条 · 动态 ${roomNotices.length} 条` : "暂无聊天消息 · 暂无房间动态"}</p>
        </div>
      </div>

      <div className="room-chat__messages" ref={messageListRef}>
        {entries.length < 1 ? (
          <div className="room-chat__empty">
            <span>暂无聊天消息</span>
            <span>暂无房间动态</span>
          </div>
        ) : entries.map(entry => {
          if (entry.entryType === "notice") {
            return (
              <div key={`notice-${entry.notice.id}`} className={`room-chat__notice room-chat__notice_${entry.notice.type}`}>
                <span className="room-chat__notice-time">{formatChatTime(entry.notice.createdAt)}</span>
                <span className="room-chat__notice-content">{entry.notice.content}</span>
              </div>
            )
          }
          const message = entry.message
          const isMine = message.senderId === myGuestId
          return (
            <div key={`chat-${message.id}`} className={`room-chat__message ${isMine ? "room-chat__message_mine" : ""}`}>
              <div className="room-chat__meta">
                <span className="room-chat__sender">{isMine ? "我" : (message.senderName || "成员")}</span>
                <span className="room-chat__time">{formatChatTime(message.createdAt)}</span>
              </div>
              <div className="room-chat__bubble">{message.content}</div>
            </div>
          )
        })}
      </div>

      <form className="room-chat__form" onSubmit={onSubmit}>
        <textarea
          value={draft}
          rows={2}
          placeholder="输入消息，Enter 发送"
          onChange={(event) => {
            setDraft(event.target.value)
            setLocalError("")
            if (chatError) onClearError()
          }}
          onKeyDown={onKeyDown}
        />
        <div className="room-chat__footer">
          <div className={`room-chat__count ${charCount > MAX_CHAT_CONTENT_LENGTH ? "room-chat__count_error" : ""}`}>
            {charCount}/{MAX_CHAT_CONTENT_LENGTH}
          </div>
          <button type="submit" disabled={charCount < 1 || charCount > MAX_CHAT_CONTENT_LENGTH}>发送</button>
        </div>
        {errorText && <div className="room-chat__error">{errorText}</div>}
      </form>
    </section>
  )
})

export default ChatPanel

function formatChatTime(createdAt: number): string {
  const date = new Date(createdAt)
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  return `${hour}:${minute}`
}
