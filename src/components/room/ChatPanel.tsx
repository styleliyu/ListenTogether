import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { ChatMessage, PageParticipant } from "../../types"

const MAX_CHAT_CONTENT_LENGTH = 300

interface ChatPanelProps {
  messages: ChatMessage[]
  participants: PageParticipant[]
  chatError?: string
  onSendMessage: (content: string) => boolean
  onClearError: () => void
}

export default function ChatPanel({
  messages,
  participants,
  chatError,
  onSendMessage,
  onClearError,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const [localError, setLocalError] = useState("")
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const myGuestId = useMemo(() => participants.find(item => item.isMe)?.guestId || "", [participants])
  const charCount = draft.trim().length
  const errorText = localError || chatError || ""

  useEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return
    messageList.scrollTop = messageList.scrollHeight
  }, [messages.length])

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
    <section className="room-chat" aria-label="房间聊天">
      <div className="room-chat__head">
        <div>
          <h2>房间聊天</h2>
          <p>{messages.length > 0 ? `最近 ${messages.length} 条消息` : "暂无聊天消息"}</p>
        </div>
      </div>

      <div className="room-chat__messages" ref={messageListRef}>
        {messages.length < 1 ? (
          <div className="room-chat__empty">还没有消息</div>
        ) : messages.map(message => {
          const isMine = message.senderId === myGuestId
          return (
            <div key={message.id} className={`room-chat__message ${isMine ? "room-chat__message_mine" : ""}`}>
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
          rows={3}
          placeholder="输入消息"
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
}

function formatChatTime(createdAt: number): string {
  const date = new Date(createdAt)
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  return `${hour}:${minute}`
}
