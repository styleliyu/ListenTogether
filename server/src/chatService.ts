import crypto from "crypto"
import type { ChatMessage } from "./types"

const MAX_CHAT_HISTORY = 50
export const MAX_CHAT_CONTENT_LENGTH = 300
const CHAT_RATE_LIMIT_WINDOW_MS = 10 * 1000
const CHAT_RATE_LIMIT_MAX = 5

const roomChatHistories = new Map<string, ChatMessage[]>()
const roomSenderStamps = new Map<string, number[]>()

interface AppendChatMessageInput {
  roomId: string
  senderId: string
  senderName?: string
  content: string
  createdAt?: number
}

interface ChatRateLimitResult {
  allowed: boolean
  retryAfterMs?: number
}

interface ChatContentResult {
  ok: boolean
  content?: string
  message?: string
}

export function appendChatMessage(input: AppendChatMessageInput): ChatMessage {
  const message: ChatMessage = {
    id: createChatMessageId(),
    roomId: input.roomId,
    senderId: input.senderId,
    senderName: input.senderName,
    content: input.content,
    createdAt: input.createdAt || Date.now()
  }

  const history = roomChatHistories.get(input.roomId) || []
  history.push(message)
  roomChatHistories.set(input.roomId, history.slice(-MAX_CHAT_HISTORY))
  return message
}

export function getChatHistory(roomId: string): ChatMessage[] {
  return [...(roomChatHistories.get(roomId) || [])]
}

export function clearRoomChatHistory(roomId: string): void {
  roomChatHistories.delete(roomId)
  for (const key of roomSenderStamps.keys()) {
    if (key.startsWith(`${roomId}:`)) roomSenderStamps.delete(key)
  }
}

export function checkChatRateLimit(roomId: string, senderId: string, now = Date.now()): ChatRateLimitResult {
  const key = `${roomId}:${senderId}`
  const windowStart = now - CHAT_RATE_LIMIT_WINDOW_MS
  const recentStamps = (roomSenderStamps.get(key) || []).filter(stamp => stamp > windowStart)

  if (recentStamps.length >= CHAT_RATE_LIMIT_MAX) {
    const retryAfterMs = CHAT_RATE_LIMIT_WINDOW_MS - (now - recentStamps[0])
    roomSenderStamps.set(key, recentStamps)
    return { allowed: false, retryAfterMs }
  }

  recentStamps.push(now)
  roomSenderStamps.set(key, recentStamps)
  return { allowed: true }
}

export function normalizeChatContent(value: unknown): ChatContentResult {
  if (typeof value !== "string") return { ok: false, message: "消息内容格式不正确" }

  const content = value.trim()
  if (!content) return { ok: false, message: "消息不能为空" }
  if (content.length > MAX_CHAT_CONTENT_LENGTH) {
    return { ok: false, message: `消息不能超过 ${MAX_CHAT_CONTENT_LENGTH} 个字符` }
  }

  return { ok: true, content }
}

function createChatMessageId(): string {
  return crypto.randomBytes(12).toString("hex")
}
