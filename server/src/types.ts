import type { IncomingHttpHeaders } from "http"
import type { WebSocket } from "ws"

export interface RequestParam {
  "x-pt-version": string
  "x-pt-client": string
  "x-pt-stamp": number
  "x-pt-language": string
  "x-pt-local-id": string
  [otherParam: string]: unknown
}

export interface RequestRes<T = Record<string, unknown>> {
  code: string
  errMsg?: string
  showMsg?: string
  data?: T
}

export interface ContentData {
  infoType: "podcast"
  audioUrl: string
  sourceType?: string
  title?: string
  description?: string
  imageUrl?: string
  linkUrl?: string
  seriesName?: string
  seriesUrl?: string
  queue?: RoomQueue
  pendingPlaylistImport?: PendingPlaylistImport
}

export interface Participant {
  nickName: string
  enterStamp: number
  heartbeatStamp: number
  userAgent?: string
  guestId: string
  nonce: string
}

export interface ParticipantClient {
  nickName: string
  guestId: string
  heartbeatStamp: number
  enterStamp: number
}

export type SpeedRate = "0.8" | "1" | "1.2" | "1.5" | "1.7"
export type PlayStatus = "PLAYING" | "PAUSED"
export type PlayMode = "sequence" | "shuffle" | "single"
export type RoomRole = "owner" | "member"

export interface QueueItem {
  id: string
  sourceType: string
  title: string
  artist?: string
  imageUrl?: string
  linkUrl?: string
  resourceId?: string
  audioUrl?: string
}

export interface RoomQueue {
  items: QueueItem[]
  currentIndex: number
  currentItemId?: string
  playMode: PlayMode
}

export interface PendingPlaylistImport {
  link: string
  items: QueueItem[]
  importedItemIds?: string[]
}

export interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  senderName?: string
  content: string
  createdAt: number
}

export type RoomNoticeType =
  | "member"
  | "permission"
  | "playlist_import"
  | "queue"
  | "playback"
  | "system"

export interface RoomNotice {
  id: string
  roomId: string
  type: RoomNoticeType
  content: string
  createdAt: number
}

export interface PlaylistImportProgress {
  status: "started" | "progress" | "completed" | "cancelled" | "failed"
  roomId: string
  link: string
  total: number
  parsedCount: number
  successCount: number
  failedCount: number
  addedCount: number
  message: string
  failedTracks?: FailedTrack[]
}

export interface FailedTrack {
  title?: string
  artist?: string
  source?: string
  reason: string
  rawReason?: string
}

export interface LocalImportFailure {
  filename: string
  reason: string
}

export interface LocalUploadMetadata {
  filename: string
  originalName: string
  title: string
  artist?: string
  album?: string
  detectedExt: string
  mime?: string
}

export interface UploadAudioData {
  content: ContentData
  importedCount: number
  failures: LocalImportFailure[]
}

export interface RoomPermissionConfig {
  memberCanControlPlayback: boolean
  memberCanManageQueue: boolean
  memberCanImportPlaylist: boolean
}

export interface RoomConfig {
  everyoneCanOperatePlayer?: "Y" | "N"
  permissions?: RoomPermissionConfig
}

export interface Room {
  _id: string
  title?: string
  roomName?: string
  content: ContentData
  oState: "OK" | "EXPIRED" | "DELETED"
  playStatus: PlayStatus
  speedRate: SpeedRate
  contentStamp: number
  operateStamp: number
  operator: string
  createStamp: number
  owner: string
  participants: Participant[]
  config?: RoomConfig
  queue?: RoomQueue
  isPersistent?: boolean
  emptyStamp?: number
}

export interface RoRes {
  roomId: string
  roomName?: string
  content: ContentData
  playStatus: PlayStatus
  speedRate: SpeedRate
  operator: string
  contentStamp: number
  operateStamp: number
  participants: ParticipantClient[]
  guestId?: string
  iamOwner?: "Y" | "N"
  roomRole?: RoomRole
  ownerGuestId?: string
  everyoneCanOperatePlayer?: "Y" | "N"
  permissions?: RoomPermissionConfig
  queue?: RoomQueue
  currentIndex?: number
  currentItemId?: string
  playMode?: PlayMode
  isPersistent?: boolean
}

export interface Visitor {
  _id: string
  nickName: string
  enterRoomStamp: number
  enterNum: number
  createNum: number
  createRoomStamp: number
  createStamp: number
  userAgent?: string
  ip?: string | string[]
  nonce: string
}

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

export interface ResToFe {
  responseType: "CONNECTED" | "NEW_STATUS" | "HEARTBEAT" | "PLAYLIST_IMPORT_PROGRESS" | "ROOM_INFO" | "OPERATION_ERROR" | "CHAT_MESSAGE" | "CHAT_HISTORY" | "ROOM_NOTICE" | "ROOM_NOTICE_HISTORY"
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
  chatMessage?: ChatMessage
  chatMessages?: ChatMessage[]
  roomNotice?: RoomNotice
  roomNotices?: RoomNotice[]
  operationError?: {
    roomId: string
    operateType?: string
    message: string
  }
}

export interface ReqBase {
  operateType: "FIRST_SEND" | "SET_PLAYER" | "HEARTBEAT" | "SET_QUEUE_INDEX" | "ADVANCE_QUEUE" | "SET_PLAY_MODE" | "APPEND_QUEUE" | "IMPORT_PLAYLIST" | "QUEUE_REMOVE_ITEM" | "QUEUE_SKIP_CURRENT" | "QUEUE_PLAY_NEXT" | "CHAT_SEND"
  roomId: string
  "x-pt-local-id": string
  "x-pt-stamp": number
}

export interface ReqOperatePlayer extends ReqBase {
  operateType: "SET_PLAYER"
  playStatus: PlayStatus
  speedRate: SpeedRate
  contentStamp: number
  everyoneCanOperatePlayer?: "Y" | "N"
}

export interface ReqSetQueueIndex extends ReqBase {
  operateType: "SET_QUEUE_INDEX"
  index: number
}

export interface ReqAdvanceQueue extends ReqBase {
  operateType: "ADVANCE_QUEUE"
  direction: "next" | "prev" | "auto"
  fromIndex: number
}

export interface ReqSetPlayMode extends ReqBase {
  operateType: "SET_PLAY_MODE"
  playMode: PlayMode
}

export interface ReqAppendQueue extends ReqBase {
  operateType: "APPEND_QUEUE"
  items: QueueItem[]
}

export interface ReqImportPlaylist extends ReqBase {
  operateType: "IMPORT_PLAYLIST"
  link: string
}

export interface ReqQueueRemoveItem extends ReqBase {
  operateType: "QUEUE_REMOVE_ITEM"
  itemId: string
}

export interface ReqQueueSkipCurrent extends ReqBase {
  operateType: "QUEUE_SKIP_CURRENT"
}

export interface ReqQueuePlayNext extends ReqBase {
  operateType: "QUEUE_PLAY_NEXT"
  itemId: string
}

export interface ReqChatSend extends ReqBase {
  operateType: "CHAT_SEND"
  content: string
}

export interface RequestContext {
  body: Record<string, any>
  method: string
  headers: IncomingHttpHeaders
  ip?: string | string[]
}

export interface PtWebSocket extends WebSocket {
  roomId?: string
  createStamp?: number
}
