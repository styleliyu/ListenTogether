
/**************** 网络请求 **************/
// 请求回调的公共入参
export interface RequestParam {
  "x-pt-version": string
  "x-pt-client": string
  "x-pt-stamp": number
  "x-pt-language": string
  "x-pt-local-id": string
  [otherParam: string]: any
}

// 请求回调的结果
export interface RequestRes<T = Record<string, any>> {
  code: string
  errMsg?: string
  showMsg?: string
  data?: T
}

/**************** 一些正常情况下的返回参数 *************/
export interface Participant {
  nickName: string
  guestId: string
  heartbeatStamp: number
  enterStamp: number
}

export interface ContentData {
  infoType: "podcast"
  audioUrl: string
  sourceType?: string
  title?: string
  description?: string
  imageUrl?: string
  linkUrl?: string
  seriesName?: string   // 播客专栏名称，比如 "商业就是这样"
  seriesUrl?: string    // 播客专栏链接
  queue?: RoomQueue
  pendingPlaylistImport?: PendingPlaylistImport
}

export type PlayMode = "sequence" | "shuffle" | "single"
export type RoomRole = "owner" | "member"

export interface RoomPermissionConfig {
  memberCanControlPlayback: boolean
  memberCanManageQueue: boolean
  memberCanImportPlaylist: boolean
}

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

export interface RoRes {
  roomId: string
  roomName?: string
  content: ContentData
  playStatus: "PLAYING" | "PAUSED"
  speedRate: "1"
  operator: string
  contentStamp: number
  operateStamp: number
  participants: Participant[]
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


/********************* 纯前端的类型 **********************/
export interface StorageUserData {
  nickName?: string
  nonce?: string
}

export interface EnvType {
  DEV: boolean
  WEBSOCKET_URL: string
  API_URL: string
  HEARTBEAT_PERIOD: number
  THIRD_PARTY_SETTING_URL?: string
  CONTACT_EMAIL?: string
  CONTACT_FEISHU?: string
  PLAUSIBLE_DOMAIN?: string
  PLAUSIBLE_SRC?: string
}
