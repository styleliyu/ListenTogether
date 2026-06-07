import type { ContentData, PageParticipant, Participant } from "../types"
import time from "./time"
import util from "./util"

export function showParticipants(participants: Participant[], myGuestId: string): PageParticipant[] {
  if (participants.length < 1) return []
  const now = time.getTime()
  return [...participants]
    .sort((a, b) => a.enterStamp - b.enterStamp)
    .map(item => {
      const diff = now - item.enterStamp
      const sec = diff / 1000
      const min = sec / 60
      const hr = min / 60
      const enterStr = sec <= 60
        ? "刚刚"
        : min >= 1 && min < 60
          ? `${Math.floor(min)} 分钟前`
          : hr < 2
            ? "一小时前"
            : "两小时前"

      return {
        guestId: item.guestId,
        nickName: item.nickName,
        enterStr,
        isMe: item.guestId === myGuestId,
      }
    })
}

export function handleShowMoreBox(content: ContentData): boolean {
  const { title, description } = content
  if (!title || !description) return false
  return getPotentialRow(description) >= 5
}

function getPotentialRow(text: string): number {
  if (!text) return 0
  return text.split("\n").reduce((rowNum, rowText) => {
    if (rowText.length <= 18) return rowNum + 1
    const chineseNum = util.getChineseCharNum(rowText)
    const otherNum = rowText.length - chineseNum
    const scores = (chineseNum * 2) + otherNum
    return rowNum + 1 + Math.floor(scores / 41)
  }, 0)
}
