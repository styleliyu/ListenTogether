// 仅用于 room-page 的类型
import { ContentData, PlayMode, PlaylistImportProgress, RoomPermissionConfig, RoomQueue, RoomRole } from "./index"

/**
 * 1: 正在进入房间...
 * 2: 获取播放器状态...
 * 3: 正常
 * 
 * 11: 链接已过期: 回首页
 * 12: 查无该房间: 回首页
 * 13: 网络不佳（请检查网络状态）: 重新进入 或 联系开发者
 * 14: 拒绝访问
 * 15：房间人数已满
 * 16: 停留过久
 * 17: 房门外（超过 5 分钟闲置，你似乎游走到门外啦！）: 重新进入
 * 18：连接异常（你的连接似乎已断开）: 重新进入 或 联系开发者 （用于 WebSocket 的问题）
 * 19: 未知的异常（可能是浏览器的原因，建议关闭后重新打开）: 重新进入 或 联系开发者
 * 
 * 20: 未知的异常 （请检查网络状态）: 重新进入 或 联系开发者
 */
export type PageState = 1 | 2 | 3 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20

export interface PageParticipant {
  guestId: string
  nickName: string
  enterStr: string      // xx 分钟前进入
  isMe: boolean
}

export interface PageData {
  state: PageState
  roomId: string,
  roomName?: string,
  isPersistent?: boolean,
  content?: ContentData,
  participants: PageParticipant[],
  showMoreBox: boolean,
  amIOwner: boolean,
  roomRole: RoomRole,
  ownerGuestId?: string,
  everyoneCanOperatePlayer: "Y" | "N"
  permissions: RoomPermissionConfig
  queue?: RoomQueue
  playlistImportMessage?: string
  playlistImportProgress?: PlaylistImportProgress
  playlistImportCollapsed: boolean
  cancellingPlaylistImport: boolean
}

type SpeedRate = "0.8" | "1" | "1.2" | "1.5" | "1.7"

export type PlayStatus = "PLAYING" | "PAUSED"

export interface RoomStatus {
  roomId: string
  roomName?: string
  playStatus: PlayStatus
  speedRate: SpeedRate
  operator: string
  contentStamp: number
  operateStamp: number
  everyoneCanOperatePlayer?: "Y" | "N"
  permissions?: RoomPermissionConfig
  content?: ContentData
  queue?: RoomQueue
  currentIndex?: number
  currentItemId?: string
  playMode?: PlayMode
}

export interface WsMsgRes {
  responseType: "CONNECTED" | "NEW_STATUS" | "HEARTBEAT" | "PLAYLIST_IMPORT_PROGRESS" | "ROOM_INFO" | "OPERATION_ERROR"
  roomStatus?: RoomStatus
  roomInfo?: {
    roomId: string
    roomName?: string
    deleted?: boolean
    ownerGuestId?: string
    everyoneCanOperatePlayer?: "Y" | "N"
    permissions?: RoomPermissionConfig
  }
  playlistImportProgress?: PlaylistImportProgress
  operationError?: {
    roomId: string
    operateType?: string
    message: string
  }
}

export type RevokeType = "ws" | "http" | "check"
