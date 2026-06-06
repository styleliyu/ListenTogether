/**
 * @file 鎴块棿澶勭悊涓婚€昏緫
 * @author yenche123 <tsuiyenche@outlook.com>
 * @copyright TSUI YEN-CHE 2022
 */
import { ref, reactive, onActivated, onDeactivated, nextTick } from "vue"
import { PageData, PageState, WsMsgRes, RoomStatus, PlayStatus, RevokeType } from "../../../type/type-room-page"
import { ContentData, PlayMode, QueueItem, RequestRes, RoRes, RoomQueue } from "../../../type"
import { RouteLocationNormalizedLoaded } from "vue-router"
import { useRouteAndPtRouter, PtRouter, goHome } from "../../../routes/pt-router"
import ptUtil from "../../../utils/pt-util"
import util from "../../../utils/util"
import time from "../../../utils/time"
import playerTool from "./player-tool"
import { showParticipants, handleShowMoreBox } from "./show-room"
import cui from "../../../components/custom-ui"
import images from "../../../images"
import ptApi from "../../../utils/pt-api"
import { initPlayer } from "./init-player"
import { initWebSocket, sendToWebSocket } from "./init-websocket"
import { shareData } from "./init-share"
import { request_cancel_playlist_import, request_delete_room, request_enter, request_heartbeat, request_leave, request_parse, request_set_room_name } from "./room-request"

// 涓€浜涘父閲?
const COLLECT_TIMEOUT = 300    // 鏀堕泦鏈€鏂扮姸鎬佺殑鏈€灏忛棿闅?
const MAX_HB_NUM = 960    // 蹇冭烦鏈€澶氳疆璇㈡鏁帮紱濡傛灉姣?15s 涓€娆★紝鐩稿綋浜?4hr
const PAUSED_IDLE_LEAVE_TIMEOUT_SEC = 30 * 60
const STALE_PLAYBACK_REPORT_SUPPRESS_MS = 2500

// 鎾斁鍣?
// 播放器状态区：只有真实切歌可以重建播放器；房间信息、导入面板和倍速 UI 不应触发重建。
let player: any;
const playerEl = ref<HTMLElement | null>(null)
let playStatus: PlayStatus = "PAUSED"    // 鎾斁鐘舵€?

// 璺敱
let router: PtRouter
let route: RouteLocationNormalizedLoaded

// web socket
let ws: WebSocket | null = null

// 缁戝畾鍒伴〉闈㈢殑鏁版嵁
// 页面状态区：队列、导入仪表盘和房间信息共用 pageData，但 WebSocket 事件入口必须按语义拆开处理。
const pageData: PageData = reactive({
  state: 1,
  roomId: "",
  roomName: "",
  isPersistent: false,
  participants: [],
  showMoreBox: false,   // 鏄惁瑕佸睍绀?鈥滃睍寮€鏇村鈥?鐨勬寜閽?
  amIOwner: false,
  everyoneCanOperatePlayer: "Y",
  queue: undefined,
  playlistImportMessage: "",
  playlistImportProgress: undefined,
  playlistImportCollapsed: false,
  cancellingPlaylistImport: false
})

// 鍏朵粬鏉備竷鏉傚叓鐨勬暟鎹?
let nickName: string = ""
let localId: string = ""
let guestId: string = ""
let intervalHb: ReturnType<typeof setInterval> | null = null
let timeoutCollect: ReturnType<typeof setTimeout> | null = null
let srcDuration: number = 0
let waitPlayer: Promise<boolean>
let latestStatus: RoomStatus    // 鏈€鏂扮殑鎾斁鍣ㄧ姸鎬?
let isShowingAutoPlayPolicy: boolean = false  // 褰撳墠鏄惁宸插湪灞曠ず autoplay policy 鐨勫脊绐?
let heartbeatNum = 0            // 蹇冭烦鐨勬鏁?
let receiveWsNum = 0            // 鏀跺埌 web-socket 鐨勬鏁?
let pausedSec = 0
let hasAppliedInitialPlaybackStatus = false
let lastAppliedPlaybackSignature = ""
let playerReadyToken = 0
let localPlaybackRate = 1

// 导入仪表盘状态区：只影响导入 UI，为未来 failedTracks 面板预留独立入口。
let playlistImportPanelTouched = false

// 鏃堕棿鎴?
let lastOperateLocalStamp = 0        // 涓婁竴涓湰鍦拌缃繙绔湇鍔″櫒鐨勬椂闂存埑
let lastNewStatusFromWsStamp = 0    // 涓婁竴娆℃敹鍒?web-socket NEW_STATUS 鐨勬椂闂存埑
let lastHeartbeatStamp = 0          // 涓婁竴娆″績璺崇殑鏃堕棿鎴?
let lastReConnectWs = 0
let suppressLocalPlaybackReportUntil = 0
let queueActionLockUntil = 0

// 鏄惁涓鸿繙绔皟鏁存挱鏀惧櫒鐘舵€侊紝濡傛灉鏄紝鍒欏湪鐩戝惉 player 鍚勫洖璋冩椂涓嶅線涓嬫墽琛?
let isRemoteSetSeek = false
let isRemoteSetPlaying = false
let isRemoteSetPaused = false
let isRemoteSetSpeedRate = false

// 鎾斁鍣ㄥ噯澶囧ソ鐨勫洖璋?
type SimpleFunc = (param1: boolean) => void
let playerAlready: SimpleFunc

interface PlayingTrackIdentity {
  id: string
  audioUrl: string
  hasStableId: boolean
}

interface RoomStatusClassification {
  trackChanged: boolean
  queueOnlyChanged: boolean
  playModeOnlyChanged: boolean
  playbackStatusChanged: boolean
}


const toHome = () => {
  goHome(router)
}

const toContact = () => {
  router.push({ name: "contact" })
}

// 鏈湴淇敼鎴戠殑鏄电О锛屽啀涓婃姤杩滅
const toEditMyName = async (newName: string) => {
  if(pageData.state !== 3) return
  const participants = pageData.participants
  // 淇敼瑙嗗浘
  for(let i=0; i<participants?.length; i++) {
    const v = participants[i]
    if(v.isMe) v.nickName = newName
  }
  nickName = newName
  // 涓婃姤杩滅
  // 閿€姣佸績璺炽€佸啀鐢ㄦ柊鐨勫績璺充笂鎶?
  await request_heartbeat(pageData.roomId, nickName)

  // 淇敼缂撳瓨
  let userData = ptUtil.getUserData()
  userData.nickName = newName
  ptUtil.setUserData(userData)
}

const onEveryoneCanOperatePlayerChange = (opt: { checked: boolean }) => {
  if(!pageData.amIOwner) return
  pageData.everyoneCanOperatePlayer = opt.checked ? "Y" : "N"
  collectLatestStatus()
}

const canOperatePlayer = (): boolean => {
  return pageData.amIOwner || pageData.everyoneCanOperatePlayer !== "N"
}

const onQueueItemTap = (index: number) => {
  if(!canOperatePlayer()) {
    showOperateFailed()
    return
  }
  sendToWebSocket(ws, {
    operateType: "SET_QUEUE_INDEX",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime(),
    index
  })
}

const onQueueAdvance = (direction: "next" | "prev") => {
  if(!canOperatePlayer()) {
    showOperateFailed()
    return
  }
  sendAdvanceQueue(direction)
}

const onQueueRemoveItem = (item: QueueItem) => {
  if(!canOperatePlayer()) {
    showOperateFailed()
    return
  }
  if(!item?.id || !canSendQueueAction()) return
  sendToWebSocket(ws, {
    operateType: "QUEUE_REMOVE_ITEM",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime(),
    itemId: item.id
  })
}

const onQueueSkipCurrent = () => {
  if(!canOperatePlayer()) {
    showOperateFailed()
    return
  }
  if(!pageData.queue?.items?.length || !canSendQueueAction()) return
  sendToWebSocket(ws, {
    operateType: "QUEUE_SKIP_CURRENT",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime()
  })
}

const onQueuePlayNext = (item: QueueItem) => {
  if(!canOperatePlayer()) {
    showOperateFailed()
    return
  }
  if(!item?.id || !canSendQueueAction()) return
  sendToWebSocket(ws, {
    operateType: "QUEUE_PLAY_NEXT",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime(),
    itemId: item.id
  })
}

const onPlayModeChange = () => {
  if(!pageData.queue) return
  if(!canOperatePlayer()) {
    showOperateFailed()
    return
  }
  const order: PlayMode[] = ["sequence", "shuffle", "single"]
  const current = pageData.queue.playMode
  const next = order[(order.indexOf(current) + 1) % order.length]
  sendToWebSocket(ws, {
    operateType: "SET_PLAY_MODE",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime(),
    playMode: next
  })
}

const onAppendQueueByLink = async () => {
  if(!canOperatePlayer()) {
    showOperateFailed()
    return
  }
  const editorRes = await cui.showTextEditor({
    title: "添加歌曲或歌单",
    placeholder: "粘贴单曲或歌单链接",
    minLength: 10,
    maxLength: 1000
  })
  if(!editorRes.confirm || !editorRes.value) return

  cui.showLoading({ title: "正在添加.." })
  const res = await request_parse(editorRes.value)
  cui.hideLoading()
  if(!res || res.code !== "0000" || !res.data?.audioUrl) {
    cui.showModal({
      title: "添加失败",
      content: res?.showMsg || "链接解析失败，请更换链接后再试。",
      showCancel: false
    })
    return
  }

  const items = contentToQueueItems(res.data)
  if(!items.length) {
    cui.showModal({
      title: "添加失败",
      content: "没有找到可播放的歌曲。",
      showCancel: false
    })
    return
  }

  sendToWebSocket(ws, {
    operateType: "APPEND_QUEUE",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime(),
    items
  })

  if(res.data.pendingPlaylistImport?.link) {
    pageData.playlistImportMessage = `已加入 ${items.length} 首，剩余歌曲后台加载中`
    playlistImportPanelTouched = false
    pageData.playlistImportCollapsed = false
    sendImportPlaylist(res.data.pendingPlaylistImport.link)
  }
}

const onCancelPlaylistImport = async () => {
  if(pageData.cancellingPlaylistImport) return
  pageData.cancellingPlaylistImport = true
  try {
    const res = await request_cancel_playlist_import(pageData.roomId)
    if(res?.data) {
      updatePlaylistImportProgress(res.data as any)
    }
    else if(res?.code === "0000") {
      pageData.playlistImportMessage = res.showMsg || "已取消导入任务"
    }
  }
  finally {
    pageData.cancellingPlaylistImport = false
  }
}

const onTogglePlaylistImportPanel = () => {
  playlistImportPanelTouched = true
  pageData.playlistImportCollapsed = !pageData.playlistImportCollapsed
}

const onRoomNameChange = async (roomName: string) => {
  if(!pageData.amIOwner) return
  const nextName = roomName.trim().slice(0, 30)
  if(!nextName) {
    cui.showModal({
      title: "提示",
      content: "房间名称不能为空",
      showCancel: false
    })
    return
  }
  const res = await request_set_room_name(pageData.roomId, nickName, nextName)
  if(res?.code !== "0000") {
    cui.showModal({
      title: "保存失败",
      content: res?.showMsg || "房间名称保存失败，请稍后再试。",
      showCancel: false
    })
    return
  }
  pageData.roomName = res.data?.roomName || nextName
}

const onDeleteRoom = async () => {
  if(!pageData.amIOwner || !pageData.isPersistent) return
  const confirm = await cui.showModal({
    title: "删除常驻房间",
    content: "删除后当前房间会失效，同房间用户将无法继续停留。确定删除吗？",
    cancelText: "取消",
    confirmText: "删除"
  })
  if(confirm.cancel) return
  const res = await request_delete_room(pageData.roomId, nickName)
  if(res?.code !== "0000") {
    cui.showModal({
      title: "删除失败",
      content: res?.showMsg || "只有房主可以删除这个房间。",
      showCancel: false
    })
    return
  }
  await cui.showModal({
    title: "房间已删除",
    content: "这个常驻房间已删除，即将返回首页。",
    showCancel: false
  })
  toHome()
}

export const useRoomPage = () => {
  const rr = useRouteAndPtRouter()
  router = rr.router
  route = rr.route
  
  init()

  return { 
    pageData, 
    playerEl, 
    route, 
    router, 
    toHome, 
    toContact, 
    toEditMyName,
    onEveryoneCanOperatePlayerChange,
    onQueueItemTap,
    onQueueAdvance,
    onQueueRemoveItem,
    onQueueSkipCurrent,
    onQueuePlayNext,
    onPlayModeChange,
    onAppendQueueByLink,
    onCancelPlaylistImport,
    onTogglePlaylistImportPanel,
    onRoomNameChange,
    onDeleteRoom,
  }
}

// 鍒濆鍖栦竴浜涗笢瑗匡紝姣斿 onActivated / onDeactivated
function init() {
  onActivated(() => {
    enterRoom()
  })

  onDeactivated(() => {
    leaveRoom()
  })
}


// 杩涘叆鎴块棿
export async function enterRoom() {
  let roomId: string = route.params.roomId as string
  pageData.roomId = roomId
  pageData.state = 1
  pausedSec = 0

  let userData = ptUtil.getUserData()
  nickName = userData.nickName as string
  localId = userData.nonce as string
  
  let res = await request_enter(roomId, nickName)
  enterResToErrState(res)
  if(!res) return
  let { code, data } = res
  if(code === "0000") {
    pageData.state = 2
    await nextTick()
    afterEnter(data as RoRes)
  }
}

function enterResToErrState(res?: RequestRes) {
  if(!res) {
    pageData.state = 13
    return
  }
  let { code } = res
  if(code === "0000") {
    return
  }
  else if(code === "E4004") {
    pageData.state = 12
  }
  else if(code === "E4006") {
    pageData.state = 11
  }
  else if(code === "E4003") {
    pageData.state = 14
  }
  else if(code === "R0001") {
    pageData.state = 15
  }
  else {
    pageData.state = 20
  }
}

// 鎴愬姛杩涘叆鎴块棿鍚?
//    璧嬪€?/ 鍒涘缓鎾斁鍣?/ 寮€鍚?20s 杞鏈哄埗 / 寤虹珛 webSocket
function afterEnter(roRes: RoRes) {
  guestId = roRes?.guestId ?? ""
  hasAppliedInitialPlaybackStatus = false
  lastAppliedPlaybackSignature = ""
  pageData.content = roRes.content
  pageData.queue = roRes.queue
  pageData.roomName = roRes.roomName || ""
  pageData.isPersistent = Boolean(roRes.isPersistent)
  pageData.amIOwner = roRes?.iamOwner === "Y" ? true : false
  pageData.participants = showParticipants(roRes.participants, guestId)
  pageData.showMoreBox = handleShowMoreBox(roRes.content)

  createPlayer()
  heartbeat()
  connectWebSocket()
  shareData(roRes.content, roRes.playStatus, nickName)
}

// 鍒涘缓鎾斁鍣?
function createPlayer() {
  let content = pageData.content as ContentData
  if(player) {
    player.destroy()
    player = null
  }
  srcDuration = 0

  waitPlayer = new Promise((a: SimpleFunc) => {
    playerAlready = a
  })
  const readyToken = ++playerReadyToken

  const audio = {
    src: content.audioUrl,
    title: content.title,
    cover: content.imageUrl || images.APP_LOGO,
    artist: content.seriesName,
  }

  const durationchange = (duration?: number) => {
    if(duration) srcDuration = duration
    showPage(readyToken)
  }
  const canplay = (e: Event) => {
    showPage(readyToken)
  }
  const loadeddata = (e: Event) => {
    showPage(readyToken)
  }

  const pause = (e: Event) => {
    playStatus = "PAUSED"
    if(isRemoteSetPaused) {
      isRemoteSetPaused = false
      return
    }
    collectLatestStatus()
  }
  const playing = (e: Event) => {
    pausedSec = 0
    playStatus = "PLAYING"
    if(isRemoteSetPlaying) {
      isRemoteSetPlaying = false
      return
    }
    collectLatestStatus()
  }
  const ratechange = (e: Event) => {
    if(isRemoteSetSpeedRate) {
      isRemoteSetSpeedRate = false
      return
    }
    localPlaybackRate = Number(player?.playbackRate || 1)
  }
  const seeked = (e: Event) => {
    if(isRemoteSetSeek) {
      isRemoteSetSeek = false
      return
    }
    collectLatestStatus()
  }
  const ended = (e: Event) => {
    if(!pageData.queue) return
    suppressLocalPlaybackReport()
    sendAdvanceQueue("auto")
  }
  const prev = () => onQueueAdvance("prev")
  const next = () => onQueueAdvance("next")
  const callbacks = {
    durationchange,
    canplay,
    loadeddata,
    pause,
    playing,
    ratechange,
    seeked,
    ended,
    prev,
    next
  }

  const onBeforeClick = (target: string): boolean => {
    if(pageData.amIOwner || !target) return true
    const list = ["play_or_pause", "forward", "backward", "speed", "seek"]
    const isRestricted = list.includes(target)
    if(pageData.everyoneCanOperatePlayer === "N" && isRestricted) {
      showOperateFailed()
      return false
    }
    return true
  }

  player = initPlayer(playerEl, audio, callbacks, onBeforeClick)
  applyLocalPlaybackRate()
  checkPlayerReady()
}

function applyLocalPlaybackRate() {
  if(!player) return
  if(Number(player.playbackRate) === localPlaybackRate) return
  isRemoteSetSpeedRate = true
  player.playbackRate = localPlaybackRate
  setTimeout(() => {
    isRemoteSetSpeedRate = false
  }, 0)
}

function getReportablePlaybackRate(): string {
  const rate = Number(player?.playbackRate || localPlaybackRate || 1)
  const options = ["0.8", "1", "1.2", "1.5", "1.7"]
  const matched = options.find(v => Math.abs(Number(v) - rate) < 0.01)
  return matched || "1"
}

function contentToQueueItems(content: ContentData): QueueItem[] {
  if(content.queue?.items?.length) return content.queue.items
  return [{
    id: `${content.sourceType || "audio"}:${content.linkUrl || content.audioUrl}`,
    sourceType: content.sourceType || "audio",
    title: content.title || content.seriesName || "音频",
    artist: content.seriesName || "",
    imageUrl: content.imageUrl || "",
    linkUrl: content.linkUrl || "",
    audioUrl: content.audioUrl
  }]
}

function sendAdvanceQueue(direction: "next" | "prev" | "auto") {
  if(!pageData.queue) return
  sendToWebSocket(ws, {
    operateType: "ADVANCE_QUEUE",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime(),
    direction,
    fromIndex: pageData.queue.currentIndex
  })
}

function sendImportPlaylist(link: string) {
  sendToWebSocket(ws, {
    operateType: "IMPORT_PLAYLIST",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime(),
    link
  })
}

function canSendQueueAction(): boolean {
  const now = time.getLocalTime()
  if(queueActionLockUntil > now) return false
  queueActionLockUntil = now + 350
  return true
}

function suppressLocalPlaybackReport(ms: number = STALE_PLAYBACK_REPORT_SUPPRESS_MS): void {
  suppressLocalPlaybackReportUntil = Math.max(suppressLocalPlaybackReportUntil, time.getLocalTime() + ms)
}

function shouldSuppressLocalPlaybackReport(): boolean {
  return time.getLocalTime() < suppressLocalPlaybackReportUntil
}

function getPlayingTrackIdentity(content?: ContentData, queue?: RoomQueue): PlayingTrackIdentity {
  const itemById = queue?.currentItemId
    ? queue.items.find(item => item.id === queue.currentItemId)
    : undefined
  const currentItem = itemById || queue?.items?.[queue.currentIndex]
  const audioUrl = currentItem?.audioUrl || content?.audioUrl || ""
  const id = queue?.currentItemId || currentItem?.id || `${content?.sourceType || "audio"}:${content?.linkUrl || audioUrl}`
  return { id, audioUrl, hasStableId: Boolean(queue?.currentItemId || currentItem?.id) }
}

function isSamePlayingTrack(
  oldContent?: ContentData,
  oldQueue?: RoomQueue,
  newContent?: ContentData,
  newQueue?: RoomQueue,
): boolean {
  const oldTrack = getPlayingTrackIdentity(oldContent, oldQueue)
  const newTrack = getPlayingTrackIdentity(newContent, newQueue)
  if(
    oldTrack.audioUrl
    && newTrack.audioUrl
    && oldTrack.audioUrl === newTrack.audioUrl
    && (!oldTrack.hasStableId || !newTrack.hasStableId)
  ) {
    return true
  }
  return oldTrack.id === newTrack.id && oldTrack.audioUrl === newTrack.audioUrl
}

function buildPlaybackSignature(status: RoomStatus, content?: ContentData, queue?: RoomQueue): string {
  const track = getPlayingTrackIdentity(content, queue)
  return [
    track.id,
    track.audioUrl,
    status.playStatus,
    status.contentStamp,
    status.operateStamp,
  ].join("|")
}

function isSameQueueItems(a?: RoomQueue, b?: RoomQueue): boolean {
  if(!a || !b) return a === b
  if(a.currentIndex !== b.currentIndex) return false
  if((a.currentItemId || "") !== (b.currentItemId || "")) return false
  if(a.items.length !== b.items.length) return false
  return a.items.every((item, index) => {
    const next = b.items[index]
    return item.id === next.id && (item.audioUrl || "") === (next.audioUrl || "")
  })
}

function classifyRoomStatus(status: RoomStatus): RoomStatusClassification {
  const oldContent = pageData.content
  const oldQueue = pageData.queue
  const nextContent = status.content || oldContent
  const nextQueue = status.queue || oldQueue
  const trackChanged = !isSamePlayingTrack(oldContent, oldQueue, nextContent, nextQueue)
  const hasQueueUpdate = Boolean(status.queue)
  const queueItemsChanged = hasQueueUpdate && !isSameQueueItems(oldQueue, nextQueue)
  const playModeOnlyChanged = Boolean(
    hasQueueUpdate
    && oldQueue
    && nextQueue
    && oldQueue.playMode !== nextQueue.playMode
    && isSameQueueItems({ ...oldQueue, playMode: nextQueue.playMode }, nextQueue)
  )
  const nextSignature = buildPlaybackSignature(status, nextContent, nextQueue)
  const playbackStatusChanged = !hasAppliedInitialPlaybackStatus || trackChanged || nextSignature !== lastAppliedPlaybackSignature

  return {
    trackChanged,
    queueOnlyChanged: hasQueueUpdate && !trackChanged && queueItemsChanged && !playbackStatusChanged,
    playModeOnlyChanged,
    playbackStatusChanged,
  }
}

function applyRoomStatus(status: RoomStatus): RoomStatusClassification {
  const classification = classifyRoomStatus(status)
  if(status.content) {
    pageData.content = status.content
    pageData.showMoreBox = handleShowMoreBox(status.content)
  }
  if(status.queue) pageData.queue = status.queue
  if(status.everyoneCanOperatePlayer) {
    pageData.everyoneCanOperatePlayer = status.everyoneCanOperatePlayer
  }
  if(typeof status.roomName === "string") {
    pageData.roomName = status.roomName
  }

  if(classification.trackChanged) {
    suppressLocalPlaybackReport()
    playStatus = "PAUSED"
    createPlayer()
  }

  return classification
}

let lastShowOperateFailed = 0
function showOperateFailed() {
  const now = time.getLocalTime()
  if(lastShowOperateFailed + 500 > now) return
  lastShowOperateFailed = now
  cui.showModal({
    title: "提示",
    content: "房主已设置仅房主能操作播放器。不过，你仍然可以调整是否静音。",
    showCancel: false,
  })
}

// 寮€濮嬫娴?player 鏄惁宸茬粡 ready
async function checkPlayerReady() {
  const cha = ptApi.getCharacteristic()
  if(!cha.isIOS && !cha.isIPadOS) {
    checkPlayerReadyAgain()
    return
  }
  await util.waitMilli(2000)
  if(srcDuration) return

  let res1 = await cui.showModal({
    title: "即将进入房间",
    content: "当前房间内可能正在播放中，是否进入？",
    cancelText: "离开",
    confirmText: "进入",
  })
  if(res1.cancel) {
    toHome()
    return
  }
  player.preloadForIOS()
  checkPlayerReadyAgain()
}

// 鍒濆鍖栨挱鏀惧櫒鍚庡啀娆℃鏌ユ挱鏀惧櫒锛屾槸鍚﹀姞杞藉埌鎾斁鏃堕暱
async function checkPlayerReadyAgain() {
  await util.waitMilli(6000)
  if(pageData.state >= 3) return
  console.log("######## 等待 6s 无结果，切换到未知异常 ########")
  console.log(" ")
  pageData.state = 19
}

function showPage(readyToken?: number): void {
  if(readyToken && readyToken !== playerReadyToken) return
  if(pageData.state <= 2) {
    pageData.state = 3
  }
  playerAlready(true)
}

// 鏀堕泦鏈€鏂扮姸鎬侊紝鍐嶇敤 ws 涓婃姤
function collectLatestStatus() {
  lastOperateLocalStamp = time.getLocalTime()
  if(timeoutCollect) clearTimeout(timeoutCollect)

  const _collect = () => {
    if(!player) return
    if(shouldSuppressLocalPlaybackReport()) return
    if(!pageData.amIOwner && pageData.everyoneCanOperatePlayer === "N") return

    const currentTime = player.currentTime ?? 0
    let contentStamp = currentTime * 1000
    contentStamp = util.numToFix(contentStamp, 0)
    let param: Record<string, any> = {
      operateType: "SET_PLAYER",
      roomId: pageData.roomId,
      "x-pt-local-id": localId,
      "x-pt-stamp": time.getTime(),
      playStatus,
      speedRate: getReportablePlaybackRate(),
      contentStamp,
    }
    if(pageData.amIOwner) {
      param.everyoneCanOperatePlayer = pageData.everyoneCanOperatePlayer
    }
    sendToWebSocket(ws, param)
    checkOperated()
  }

  timeoutCollect = setTimeout(() => {
    _collect()
  }, COLLECT_TIMEOUT)
}

// 妫€鏌ユ搷浣滄挱鏀惧櫒 杩滅鏄惁鏈夋敹鍒?
async function checkOperated() {
  await util.waitMilli(2500)
  const now = time.getLocalTime()
  const diff = now - lastNewStatusFromWsStamp
  console.log("检查操作播放器远端是否接收，时间差（理想状态小于 2500）:")
  console.log(diff)
  console.log(" ")
  if(diff < 3000) return

  // 鍘婚噸鏂拌繛鎺?web-socket
  connectWebSocket()
}

// 姣忚嫢骞茬鐨勫績璺?
function heartbeat() {
  const _env = util.getEnv()
  heartbeatNum = 0
  lastHeartbeatStamp = 0

  const _closeRoom = (val: PageState, sendLeave: boolean = false) => {
    pageData.state = val
    leaveRoom(sendLeave)
  }

  const _newRoomStatus = (roRes: RoRes) => {
    pageData.participants = showParticipants(roRes.participants, guestId)

    const now = time.getLocalTime()
    const diff1 = now - lastOperateLocalStamp
    const diff2 = now - lastNewStatusFromWsStamp
    if(diff1 < 900) {
      console.log("刚刚 900ms 内本地有播放器操作")
      console.log("跳过心跳状态采纳")
      console.log(" ")
      return
    }
    if(diff2 < 900) {
      console.log("刚刚 900ms 内 web-socket 发来最新状态")
      console.log("跳过心跳状态采纳")
      console.log(" ")
      return
    }

    latestStatus = {
      roomId: roRes.roomId,
      roomName: roRes.roomName,
      content: roRes.content,
      playStatus: roRes.playStatus,
      speedRate: roRes.speedRate,
      operator: roRes.operator,
      contentStamp: roRes.contentStamp,
      operateStamp: roRes.operateStamp,
      queue: roRes.queue,
      currentIndex: roRes.currentIndex,
      currentItemId: roRes.currentItemId,
      playMode: roRes.playMode
    }
    if(roRes.everyoneCanOperatePlayer) {
      latestStatus.everyoneCanOperatePlayer = roRes.everyoneCanOperatePlayer
    }
    receiveNewStatus("http")
  }

  const _webSocketHb = () => {
    const send = {
      operateType: "HEARTBEAT",
      roomId: pageData.roomId,
      "x-pt-local-id": localId,
      "x-pt-stamp": time.getTime()
    }
    sendToWebSocket(ws, send)
  }

  intervalHb = setInterval(async () => {

    // 蹇冭烦鏁版湁娌℃湁瓒呰繃鏈€澶у€?
    heartbeatNum++
    if(heartbeatNum > MAX_HB_NUM) {
      _closeRoom(16, true)
      return
    }

    // 妫€鏌ヤ笂涓€娆″績璺崇殑鏃堕棿锛屽鏋滆秴杩?35s
    // 灏变唬琛ㄨ娴忚鍣ㄩ檺鍒跺畾鏃朵簡锛屾墽琛?resume
    const now = time.getLocalTime()
    if(lastHeartbeatStamp > 0 && lastHeartbeatStamp + 35000 < now) {
      resume()
      return
    }
    lastHeartbeatStamp = now

    // 妫€鏌ユ槸鍚﹀凡鏆傚仠 5 鍒嗛挓
    if(playStatus === "PAUSED") {
      pausedSec += _env.HEARTBEAT_PERIOD
      if(pausedSec >= PAUSED_IDLE_LEAVE_TIMEOUT_SEC) {
        _closeRoom(17, true)
        return
      }
    }
    else pausedSec = 0

    const res = await request_heartbeat(pageData.roomId, nickName)
    if(!res) return
    const { code, data } = res
    if(code === "0000") {
      _newRoomStatus(data as RoRes)
      _webSocketHb()
    }
    else if(code === "E4004") _closeRoom(12, false)
    else if(code === "E4006") _closeRoom(11, false)
    else if(code === "E4003") _closeRoom(14, false)

  }, _env.HEARTBEAT_PERIOD * 1000)
}

// 鐢ㄦ埛鎭睆鍚庛€佸啀鎵撳紑锛屽彲鑳藉湪杩欎箣闂寸殑瀹氭椂鍣ㄨ娴忚鍣ㄩ檺鍒朵簡
// 娌℃湁浜嗘渶鏂扮姸鎬侊紝鎵€浠ヨ繘琛屾仮澶?
async function resume() {
  console.log("执行 resume......................")
  console.log(" ")
  pausedSec = 0

  // 閿€姣佸績璺?
  if(intervalHb) clearInterval(intervalHb)
  intervalHb = null

  cui.showLoading({ title: "请稍等.." })

  // 鍏抽棴 web-socket
  if(ws) {
    try {
      ws.close()
    }
    catch(err) {}
    await util.waitMilli(500)
  }
  let res = await request_enter(pageData.roomId, nickName)
  console.log("重新进入房间的结果.........")
  console.log(res)
  console.log(" ")
  cui.hideLoading()
  enterResToErrState(res)
  if(!res || res.code !== "0000") {
    leaveRoom()
    return
  }
  let roRes = res.data as RoRes
  guestId = roRes.guestId ?? ""
  pageData.participants = showParticipants(roRes.participants, guestId)
  pageData.roomName = roRes.roomName || ""
  pageData.isPersistent = Boolean(roRes.isPersistent)
  latestStatus = {
    roomId: roRes.roomId,
    roomName: roRes.roomName,
    content: roRes.content,
    playStatus: roRes.playStatus,
    speedRate: roRes.speedRate,
    operator: roRes.operator,
    contentStamp: roRes.contentStamp,
    operateStamp: roRes.operateStamp,
    queue: roRes.queue,
    currentIndex: roRes.currentIndex,
    currentItemId: roRes.currentItemId,
    playMode: roRes.playMode,
    everyoneCanOperatePlayer: roRes.everyoneCanOperatePlayer
  }
  await receiveNewStatus("http")
  heartbeat()
  connectWebSocket()
}

// 浣跨敤 web-socket 鍘诲缓绔嬭繛鎺?
function connectWebSocket() {
  receiveWsNum = 0

  const onmessage = (msgRes: WsMsgRes) => {
    receiveWsNum++
    handleWebSocketMessage(msgRes)
  }

  const onclose = (closeEvent: CloseEvent) => {
    const { code } = closeEvent
    const now = time.getLocalTime()

    // 鐩戝惉鍏抽棴鐨勭姸鎬佺爜锛?006 涓洪潪棰勬湡鐨勬儏鍐?
    // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
    if(code === 1006) {
      // 鍋氫竴涓槻鎶栬妭娴?
      if(lastReConnectWs + 5000 > now) return
      lastHeartbeatStamp = now
      connectWebSocket()
    }
  }

  const callbacks = {
    onmessage,
    onclose
  }
  ws = initWebSocket(callbacks)
  checkWebSocket()
}

function handleWebSocketMessage(msgRes: WsMsgRes): void {
  if(msgRes.responseType === "CONNECTED") {
    firstSend()
    return
  }
  if(msgRes.responseType === "NEW_STATUS") {
    handleRoomStatusMessage(msgRes)
    return
  }
  if(msgRes.responseType === "ROOM_INFO") {
    handleRoomInfoMessage(msgRes)
    return
  }
  if(msgRes.responseType === "PLAYLIST_IMPORT_PROGRESS") {
    handlePlaylistImportProgressMessage(msgRes)
    return
  }
  if(msgRes.responseType === "HEARTBEAT") {
    console.log("收到 ws 的 HEARTBEAT")
    console.log(" ")
  }
}

function handleRoomStatusMessage(msgRes: WsMsgRes): void {
  if(!msgRes.roomStatus) return
  lastNewStatusFromWsStamp = time.getLocalTime()
  latestStatus = msgRes.roomStatus
  receiveNewStatus()
}

function handleRoomInfoMessage(msgRes: WsMsgRes): void {
  const info = msgRes.roomInfo
  if(!info || info.roomId !== pageData.roomId) return
  if(info.deleted) {
    pageData.state = 12
    leaveRoom(false)
    return
  }
  pageData.roomName = info.roomName || ""
}

function handlePlaylistImportProgressMessage(msgRes: WsMsgRes): void {
  const progress = msgRes.playlistImportProgress
  if(!progress || progress.roomId !== pageData.roomId) return
  updatePlaylistImportProgress(progress)
  if(progress.status === "failed") {
    cui.showModal({
      title: "导入失败",
      content: progress.message,
      showCancel: false
    })
  }
}

function updatePlaylistImportProgress(progress: NonNullable<WsMsgRes["playlistImportProgress"]>) {
  pageData.playlistImportProgress = progress
  pageData.playlistImportMessage = progress.message
  if(progress.status === "started") {
    playlistImportPanelTouched = false
    pageData.playlistImportCollapsed = false
    return
  }
  if(progress.status === "progress") {
    if(!playlistImportPanelTouched) pageData.playlistImportCollapsed = false
    return
  }
  if(!playlistImportPanelTouched) {
    pageData.playlistImportCollapsed = true
  }
}

// 绛夊緟 5s 鏌ョ湅 web-socket 鏄惁杩炴帴
async function checkWebSocket() {
  await util.waitMilli(5000)
  if(receiveWsNum < 2) {
    pageData.state = 18
    leaveRoom()
  }
}

// "棣栨鍙戦€? 缁?websocket
function firstSend() {
  const send = {
    operateType: "FIRST_SEND",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime()
  }
  sendToWebSocket(ws, send)
}

async function receiveNewStatus(fromType: RevokeType = "ws") {
  if(latestStatus.roomId !== pageData.roomId) return
  const statusType = applyRoomStatus(latestStatus)
  if(!statusType.trackChanged && !statusType.playbackStatusChanged) return

  await waitPlayer
  hasAppliedInitialPlaybackStatus = true
  let { contentStamp } = latestStatus

  // 鍒ゆ柇鏃堕棿
  let reSeekSec = playerTool.getReSeek(latestStatus, srcDuration, player.currentTime, fromType)
  if(reSeekSec >= 0) {
    isRemoteSetSeek = true
    player.seek(reSeekSec)
    checkSeek()
  }

  applyLocalPlaybackRate()

  const rPlayStatus = latestStatus.playStatus
  let diff2 = (srcDuration * 1000) - contentStamp
  const shouldForcePlayAfterTrackChange = statusType.trackChanged && rPlayStatus === "PLAYING"
  if(shouldForcePlayAfterTrackChange || rPlayStatus !== playStatus) {
    if(!statusType.trackChanged && rPlayStatus === "PLAYING" && diff2 < 1000) return
    if(rPlayStatus === "PLAYING" && !isShowingAutoPlayPolicy) {
      console.log("远端请求播放......")
      isRemoteSetPlaying = true
      try {
        player.play()
      }
      catch(err) {
        console.log("播放失败.....")
        console.log(err)
      }
      checkIsPlaying()
    }
    else if(rPlayStatus === "PAUSED") {
      console.log("远端请求暂停......")
      isRemoteSetPaused = true
      player.pause()
    }
  }
  lastAppliedPlaybackSignature = buildPlaybackSignature(latestStatus, pageData.content, pageData.queue)
}

// 鐢变簬 iOS 鍒濆鍖栨椂璁剧疆鏃堕棿鐐?浼氫笉璧蜂綔鐢?
// 鎵€浠ラ噸鏂板仛妫€鏌?
async function checkSeek() {
  await util.waitMilli(600)
  let reSeekSec = playerTool.getReSeek(latestStatus, srcDuration, player.currentTime, "check")
  if(reSeekSec >= 0) {
    isRemoteSetSeek = true
    player.seek(reSeekSec)
  }
}

async function checkIsPlaying() {
  await util.waitMilli(1500)
  const rPlayStatus = latestStatus.playStatus
  if(rPlayStatus === "PLAYING" && playStatus === "PAUSED") {
    handleAutoPlayPolicy()
  }
}

async function handleAutoPlayPolicy() {
  if(isShowingAutoPlayPolicy) return

  isShowingAutoPlayPolicy = true
  let res1 = await cui.showModal({
    title: "当前房间正在播放",
    content: "静音还是打开声音？",
    cancelText: "静音",
    confirmText: "开声音"
  })
  isShowingAutoPlayPolicy = false

  // 濡傛灉鏄潤闊?
  if(res1.cancel) {
    player.muted = true
  }

  // 璋冩暣杩涘害鏉?
  let reSeekSec = playerTool.getReSeek(latestStatus, srcDuration, player.currentTime, "check")
  if(reSeekSec >= 0) {
    isRemoteSetSeek = true
    player.seek(reSeekSec)
  }

  // 寮€濮嬫挱鏀?
  if(latestStatus.playStatus === "PLAYING") {
    isRemoteSetPlaying = true
    player.play()
  }
}


// 绂诲紑鎴块棿
async function leaveRoom(sendLeave: boolean = true) {
  // 閿€姣佸績璺?
  if(intervalHb) clearInterval(intervalHb)
  intervalHb = null

  // 鍏抽棴 web-socket
  if(ws) {
    ws.close()
  }

  // 閿€姣佹挱鏀惧櫒
  if(player) {
    player.destroy()
    player = null
  }

  if(!sendLeave) return
  // 鍘诲彂閫佺寮€鎴块棿鐨勮姹?
  await request_leave(pageData.roomId, nickName)
}
