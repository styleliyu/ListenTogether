import { RefObject, useCallback, useEffect, useMemo, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useRoomStore } from "../stores/roomStore"
import { useHeartbeat } from "./useHeartbeat"
import { useRoomWebSocket } from "./useRoomWebSocket"
import {
  getReSeek,
  isSamePlayingTrack,
  isSameQueueItems,
  useAudioPlayer,
} from "./useAudioPlayer"
import ptUtil from "../utils/pt-util"
import time from "../utils/time"
import util from "../utils/util"
import {
  requestCancelPlaylistImport,
  requestDeleteRoom,
  requestEnter,
  requestHeartbeat,
  requestLeave,
  requestParse,
  requestSetRoomName,
  requestSetRoomPermissions,
  requestTransferOwner,
} from "../services/roomRequest"
import { handleShowMoreBox, showParticipants } from "../utils/format"
import type {
  ContentData,
  PageState,
  PlayMode,
  QueueItem,
  RevokeType,
  RoomQueue,
  RoomStatus,
  WsMsgRes,
} from "../types"

const COLLECT_TIMEOUT = 300
const MAX_HB_NUM = 960
const PAUSED_IDLE_LEAVE_TIMEOUT_SEC = 30 * 60
const STALE_PLAYBACK_REPORT_SUPPRESS_MS = 2500

interface RoomStatusClassification {
  trackChanged: boolean
  playbackStatusChanged: boolean
}

export function useRoomPage(playerEl: RefObject<HTMLElement>) {
  const { roomId = "" } = useParams()
  const navigate = useNavigate()
  const pageData = useRoomStore(state => state.pageData)
  const store = useRoomStore
  const heartbeat = useHeartbeat()
  const websocket = useRoomWebSocket()
  const audio = useAudioPlayer(playerEl)

  const nickNameRef = useRef("")
  const localIdRef = useRef("")
  const guestIdRef = useRef("")
  const latestStatusRef = useRef<RoomStatus | null>(null)
  const timeoutCollectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatNumRef = useRef(0)
  const pausedSecRef = useRef(0)
  const hasAppliedInitialPlaybackStatusRef = useRef(false)
  const lastAppliedPlaybackSignatureRef = useRef("")
  const lastOperateLocalStampRef = useRef(0)
  const lastNewStatusFromWsStampRef = useRef(0)
  const lastHeartbeatStampRef = useRef(0)
  const lastReconnectWsRef = useRef(0)
  const suppressLocalPlaybackReportUntilRef = useRef(0)
  const queueActionLockUntilRef = useRef(0)
  const playlistImportPanelTouchedRef = useRef(false)

  const canControlPlayback = useCallback(() => {
    const data = store.getState().pageData
    return data.amIOwner || data.permissions.memberCanControlPlayback
  }, [store])

  const canManageQueue = useCallback(() => {
    const data = store.getState().pageData
    return data.amIOwner || data.permissions.memberCanManageQueue
  }, [store])

  const canImportPlaylist = useCallback(() => {
    const data = store.getState().pageData
    return data.amIOwner || data.permissions.memberCanImportPlaylist
  }, [store])

  const showOperateFailed = useCallback((content = "你没有权限执行这个操作。") => {
    window.alert(content)
  }, [])

  const sendWs = useCallback((obj: Record<string, any>) => {
    websocket.send({
      roomId: store.getState().pageData.roomId,
      "x-pt-local-id": localIdRef.current,
      "x-pt-stamp": time.getTime(),
      ...obj,
    })
  }, [store, websocket])

  const canSendQueueAction = useCallback((): boolean => {
    const now = time.getLocalTime()
    if (queueActionLockUntilRef.current > now) return false
    queueActionLockUntilRef.current = now + 350
    return true
  }, [])

  const suppressLocalPlaybackReport = useCallback((ms = STALE_PLAYBACK_REPORT_SUPPRESS_MS) => {
    suppressLocalPlaybackReportUntilRef.current = Math.max(
      suppressLocalPlaybackReportUntilRef.current,
      time.getLocalTime() + ms,
    )
  }, [])

  const shouldSuppressLocalPlaybackReport = useCallback(() => {
    return time.getLocalTime() < suppressLocalPlaybackReportUntilRef.current
  }, [])

  const buildPlaybackSignature = useCallback((status: RoomStatus, content?: ContentData, queue?: RoomQueue): string => {
    const itemById = queue?.currentItemId ? queue.items.find(item => item.id === queue.currentItemId) : undefined
    const currentItem = itemById || queue?.items?.[queue.currentIndex]
    const audioUrl = currentItem?.audioUrl || content?.audioUrl || ""
    const id = queue?.currentItemId || currentItem?.id || `${content?.sourceType || "audio"}:${content?.linkUrl || audioUrl}`
    return [id, audioUrl, status.playStatus, status.contentStamp, status.operateStamp].join("|")
  }, [])

  const classifyRoomStatus = useCallback((status: RoomStatus): RoomStatusClassification => {
    const data = store.getState().pageData
    const nextContent = status.content || data.content
    const nextQueue = status.queue || data.queue
    const trackChanged = !isSamePlayingTrack(data.content, data.queue, nextContent, nextQueue)
    const nextSignature = buildPlaybackSignature(status, nextContent, nextQueue)
    const playbackStatusChanged = !hasAppliedInitialPlaybackStatusRef.current
      || trackChanged
      || nextSignature !== lastAppliedPlaybackSignatureRef.current
    return { trackChanged, playbackStatusChanged }
  }, [buildPlaybackSignature, store])

  const createPlayer = useCallback(() => {
    const data = store.getState().pageData
    const content = data.content
    if (!content?.audioUrl) return

    audio.createPlayer(content, {
      durationchange: () => undefined,
      pause: () => {
        audio.playStatusRef.current = "PAUSED"
        collectLatestStatus()
      },
      playing: () => {
        pausedSecRef.current = 0
        audio.playStatusRef.current = "PLAYING"
        collectLatestStatus()
      },
      ratechange: () => undefined,
      seeked: () => collectLatestStatus(),
      ended: () => {
        if (!store.getState().pageData.queue) return
        suppressLocalPlaybackReport()
        sendAdvanceQueue("auto")
      },
      prev: () => onQueueAdvance("prev"),
      next: () => onQueueAdvance("next"),
    }, (target) => {
      if (store.getState().pageData.amIOwner || !target) return true
      const restricted = ["play_or_pause", "forward", "backward", "speed", "seek"].includes(target)
      if (restricted && !canControlPlayback()) {
        showOperateFailed("房主已关闭普通成员播放控制权限。")
        return false
      }
      return true
    })
    audio.applyLocalPlaybackRate()
  }, [audio, canControlPlayback, showOperateFailed, store, suppressLocalPlaybackReport])

  const applyRoomStatus = useCallback((status: RoomStatus): RoomStatusClassification => {
    const classification = classifyRoomStatus(status)
    const current = store.getState().pageData
    const patch: Partial<typeof current> = {}
    if (status.content) {
      patch.content = status.content
      patch.showMoreBox = handleShowMoreBox(status.content)
    }
    if (status.queue) patch.queue = status.queue
    if (typeof status.roomName === "string") patch.roomName = status.roomName
    store.getState().patchPageData(patch)
    if (status.everyoneCanOperatePlayer || status.permissions) {
      store.getState().applyPermissions(status.permissions, status.everyoneCanOperatePlayer)
    }

    if (classification.trackChanged) {
      suppressLocalPlaybackReport()
      audio.playStatusRef.current = "PAUSED"
      createPlayer()
    }
    return classification
  }, [audio.playStatusRef, classifyRoomStatus, createPlayer, store, suppressLocalPlaybackReport])

  const receiveNewStatus = useCallback(async (fromType: RevokeType = "ws") => {
    const latestStatus = latestStatusRef.current
    const data = store.getState().pageData
    if (!latestStatus || latestStatus.roomId !== data.roomId) return

    const statusType = applyRoomStatus(latestStatus)
    if (!statusType.trackChanged && !statusType.playbackStatusChanged) return

    await audio.waitReady()
    hasAppliedInitialPlaybackStatusRef.current = true
    const player = audio.playerRef.current
    if (!player) return

    const reSeekSec = getReSeek(
      latestStatus,
      audio.srcDurationRef.current,
      player.currentTime || 0,
      fromType,
    )
    if (reSeekSec >= 0) audio.seekByRemote(reSeekSec)

    audio.applyLocalPlaybackRate()

    const diffToEnd = (audio.srcDurationRef.current * 1000) - latestStatus.contentStamp
    const shouldForcePlayAfterTrackChange = statusType.trackChanged && latestStatus.playStatus === "PLAYING"
    if (shouldForcePlayAfterTrackChange || latestStatus.playStatus !== audio.playStatusRef.current) {
      if (!statusType.trackChanged && latestStatus.playStatus === "PLAYING" && diffToEnd < 1000) return
      if (latestStatus.playStatus === "PLAYING") {
        try {
          audio.playByRemote()
        }
        catch (err) {
          console.log("播放失败.....")
          console.log(err)
        }
      }
      else {
        audio.pauseByRemote()
      }
    }

    lastAppliedPlaybackSignatureRef.current = buildPlaybackSignature(
      latestStatus,
      store.getState().pageData.content,
      store.getState().pageData.queue,
    )
  }, [applyRoomStatus, audio, buildPlaybackSignature, store])

  const handleWebSocketMessage = useCallback((msgRes: WsMsgRes) => {
    if (msgRes.responseType === "CONNECTED") {
      sendWs({ operateType: "FIRST_SEND" })
      return
    }
    if (msgRes.responseType === "NEW_STATUS" && msgRes.roomStatus) {
      lastNewStatusFromWsStampRef.current = time.getLocalTime()
      latestStatusRef.current = msgRes.roomStatus
      void receiveNewStatus("ws")
      return
    }
    if (msgRes.responseType === "ROOM_INFO") {
      const info = msgRes.roomInfo
      const data = store.getState().pageData
      if (!info || info.roomId !== data.roomId) return
      if (info.deleted) {
        store.getState().setPageState(12)
        leaveRoom(false)
        return
      }
      store.getState().patchPageData({ roomName: info.roomName || "" })
      store.getState().applyPermissions(info.permissions, info.everyoneCanOperatePlayer)
      store.getState().applyOwnerGuestId(info.ownerGuestId, guestIdRef.current)
      return
    }
    if (msgRes.responseType === "PLAYLIST_IMPORT_PROGRESS") {
      const progress = msgRes.playlistImportProgress
      if (!progress || progress.roomId !== store.getState().pageData.roomId) return
      store.getState().updatePlaylistImportProgress(progress, playlistImportPanelTouchedRef.current)
      if (progress.status === "failed") window.alert(progress.message)
      return
    }
    if (msgRes.responseType === "OPERATION_ERROR") {
      const error = msgRes.operationError
      if (!error || error.roomId !== store.getState().pageData.roomId) return
      showOperateFailed(error.message || "你没有权限执行这个操作。")
    }
  }, [receiveNewStatus, sendWs, showOperateFailed, store])

  const connectWebSocket = useCallback(() => {
    websocket.connect({
      onMessage: handleWebSocketMessage,
      onClose: (event) => {
        const now = time.getLocalTime()
        if (event.code === 1006 && lastReconnectWsRef.current + 5000 <= now) {
          lastReconnectWsRef.current = now
          lastHeartbeatStampRef.current = now
          connectWebSocket()
        }
      },
    })
  }, [handleWebSocketMessage, websocket])

  const enterResToErrState = useCallback((code?: string): PageState | null => {
    if (!code) return 13
    if (code === "0000") return null
    if (code === "E4004") return 12
    if (code === "E4006") return 11
    if (code === "E4003") return 14
    if (code === "R0001") return 15
    return 20
  }, [])

  const enterRoom = useCallback(async () => {
    store.getState().reset()
    store.getState().setRoomId(roomId)
    store.getState().setPageState(1)
    pausedSecRef.current = 0
    heartbeatNumRef.current = 0
    hasAppliedInitialPlaybackStatusRef.current = false
    lastAppliedPlaybackSignatureRef.current = ""

    const userData = ptUtil.getUserData()
    nickNameRef.current = userData.nickName || ""
    localIdRef.current = userData.nonce || ""

    const res = await requestEnter(roomId, nickNameRef.current)
    const errState = enterResToErrState(res?.code)
    if (errState) {
      store.getState().setPageState(errState)
      return
    }
    if (!res?.data) return

    const roRes = res.data
    guestIdRef.current = roRes.guestId || ""
    store.getState().patchPageData({
      state: 2,
      content: roRes.content,
      queue: roRes.queue,
      participants: showParticipants(roRes.participants, guestIdRef.current),
      showMoreBox: handleShowMoreBox(roRes.content),
    })
    store.getState().applyRoomMeta(roRes, guestIdRef.current)
    createPlayer()
    connectWebSocket()
    startHeartbeat()
  }, [connectWebSocket, createPlayer, enterResToErrState, roomId, store])

  const leaveRoom = useCallback(async (sendLeave = true) => {
    heartbeat.stop()
    websocket.close()
    audio.destroyPlayer()
    if (sendLeave && store.getState().pageData.roomId && nickNameRef.current) {
      await requestLeave(store.getState().pageData.roomId, nickNameRef.current)
    }
  }, [audio, heartbeat, store, websocket])

  const startHeartbeat = useCallback(() => {
    heartbeat.start(async () => {
      heartbeatNumRef.current++
      if (heartbeatNumRef.current > MAX_HB_NUM) {
        store.getState().setPageState(16)
        await leaveRoom(true)
        return
      }

      const now = time.getLocalTime()
      if (lastHeartbeatStampRef.current > 0 && lastHeartbeatStampRef.current + 35000 < now) {
        lastHeartbeatStampRef.current = now
      }
      lastHeartbeatStampRef.current = now

      if (audio.playStatusRef.current === "PAUSED") {
        pausedSecRef.current += util.getEnv().HEARTBEAT_PERIOD
        if (pausedSecRef.current >= PAUSED_IDLE_LEAVE_TIMEOUT_SEC) {
          store.getState().setPageState(17)
          await leaveRoom(true)
          return
        }
      }
      else {
        pausedSecRef.current = 0
      }

      const data = store.getState().pageData
      const res = await requestHeartbeat(data.roomId, nickNameRef.current)
      if (!res) return
      if (res.code === "0000" && res.data) {
        const roRes = res.data
        store.getState().setParticipants(showParticipants(roRes.participants, guestIdRef.current))
        store.getState().applyRoomMeta(roRes, guestIdRef.current)
        const diffLocal = now - lastOperateLocalStampRef.current
        const diffWs = now - lastNewStatusFromWsStampRef.current
        if (diffLocal >= 900 && diffWs >= 900) {
          latestStatusRef.current = {
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
            everyoneCanOperatePlayer: roRes.everyoneCanOperatePlayer,
            permissions: roRes.permissions,
          }
          await receiveNewStatus("http")
        }
        sendWs({ operateType: "HEARTBEAT" })
      }
      else if (res.code === "E4004") store.getState().setPageState(12)
      else if (res.code === "E4006") store.getState().setPageState(11)
      else if (res.code === "E4003") store.getState().setPageState(14)
    })
  }, [audio.playStatusRef, heartbeat, leaveRoom, receiveNewStatus, sendWs, store])

  function collectLatestStatus() {
    lastOperateLocalStampRef.current = time.getLocalTime()
    if (timeoutCollectRef.current) clearTimeout(timeoutCollectRef.current)
    timeoutCollectRef.current = setTimeout(() => {
      const player = audio.playerRef.current
      if (!player || shouldSuppressLocalPlaybackReport() || !canControlPlayback()) return
      const contentStamp = util.numToFix((player.currentTime || 0) * 1000, 0)
      const data = store.getState().pageData
      sendWs({
        operateType: "SET_PLAYER",
        playStatus: audio.playStatusRef.current,
        speedRate: String(audio.localPlaybackRateRef.current || 1),
        contentStamp,
        ...(data.amIOwner ? { everyoneCanOperatePlayer: data.everyoneCanOperatePlayer } : {}),
      })
    }, COLLECT_TIMEOUT)
  }

  function sendAdvanceQueue(direction: "next" | "prev" | "auto") {
    const data = store.getState().pageData
    if (!data.queue) return
    sendWs({
      operateType: "ADVANCE_QUEUE",
      direction,
      fromIndex: data.queue.currentIndex,
    })
  }

  const onQueueItemTap = useCallback((index: number) => {
    if (!canControlPlayback()) return showOperateFailed("房主已关闭普通成员播放控制权限。")
    sendWs({ operateType: "SET_QUEUE_INDEX", index })
  }, [canControlPlayback, sendWs, showOperateFailed])

  const onQueueAdvance = useCallback((direction: "next" | "prev") => {
    if (!canControlPlayback()) return showOperateFailed("房主已关闭普通成员播放控制权限。")
    sendAdvanceQueue(direction)
  }, [canControlPlayback, showOperateFailed])

  const onQueueRemoveItem = useCallback((item: QueueItem) => {
    if (!canManageQueue()) return showOperateFailed("房主已关闭普通成员管理队列权限。")
    if (!item?.id || !canSendQueueAction()) return
    sendWs({ operateType: "QUEUE_REMOVE_ITEM", itemId: item.id })
  }, [canManageQueue, canSendQueueAction, sendWs, showOperateFailed])

  const onQueueSkipCurrent = useCallback(() => {
    if (!canManageQueue()) return showOperateFailed("房主已关闭普通成员管理队列权限。")
    if (!store.getState().pageData.queue?.items?.length || !canSendQueueAction()) return
    sendWs({ operateType: "QUEUE_SKIP_CURRENT" })
  }, [canManageQueue, canSendQueueAction, sendWs, showOperateFailed, store])

  const onQueuePlayNext = useCallback((item: QueueItem) => {
    if (!canManageQueue()) return showOperateFailed("房主已关闭普通成员管理队列权限。")
    if (!item?.id || !canSendQueueAction()) return
    sendWs({ operateType: "QUEUE_PLAY_NEXT", itemId: item.id })
  }, [canManageQueue, canSendQueueAction, sendWs, showOperateFailed])

  const onPlayModeChange = useCallback(() => {
    const data = store.getState().pageData
    if (!data.queue) return
    if (!canControlPlayback()) return showOperateFailed("房主已关闭普通成员播放控制权限。")
    const order: PlayMode[] = ["sequence", "shuffle", "single"]
    const next = order[(order.indexOf(data.queue.playMode) + 1) % order.length]
    sendWs({ operateType: "SET_PLAY_MODE", playMode: next })
  }, [canControlPlayback, sendWs, showOperateFailed, store])

  const onAppendQueueByLink = useCallback(async () => {
    if (!canManageQueue() && !canImportPlaylist()) return showOperateFailed("房主已关闭普通成员添加歌曲或导入歌单权限。")
    const link = window.prompt("粘贴单曲或歌单链接")
    if (!link) return
    const res = await requestParse(link)
    if (!res || res.code !== "0000" || !res.data?.audioUrl) {
      window.alert(res?.showMsg || "链接解析失败，请更换链接后再试。")
      return
    }
    const items = contentToQueueItems(res.data)
    if (!items.length) {
      window.alert("没有找到可播放的歌曲。")
      return
    }
    sendWs({ operateType: "APPEND_QUEUE", items })
    if (res.data.pendingPlaylistImport?.link) {
      playlistImportPanelTouchedRef.current = false
      store.getState().patchPageData({
        playlistImportMessage: `已加入 ${items.length} 首，剩余歌曲后台加载中`,
        playlistImportCollapsed: false,
      })
      if (canImportPlaylist()) sendWs({ operateType: "IMPORT_PLAYLIST", link: res.data.pendingPlaylistImport.link })
    }
  }, [canImportPlaylist, canManageQueue, sendWs, showOperateFailed, store])

  const onCancelPlaylistImport = useCallback(async () => {
    if (!canImportPlaylist()) return showOperateFailed("房主已关闭普通成员导入歌单权限。")
    if (store.getState().pageData.cancellingPlaylistImport) return
    store.getState().patchPageData({ cancellingPlaylistImport: true })
    try {
      const res = await requestCancelPlaylistImport(store.getState().pageData.roomId)
      if (res?.data) store.getState().updatePlaylistImportProgress(res.data as any, playlistImportPanelTouchedRef.current)
      else if (res?.code === "0000") store.getState().patchPageData({ playlistImportMessage: res.showMsg || "已取消导入任务" })
    }
    finally {
      store.getState().patchPageData({ cancellingPlaylistImport: false })
    }
  }, [canImportPlaylist, showOperateFailed, store])

  const onTogglePlaylistImportPanel = useCallback(() => {
    playlistImportPanelTouchedRef.current = true
    const collapsed = store.getState().pageData.playlistImportCollapsed
    store.getState().patchPageData({ playlistImportCollapsed: !collapsed })
  }, [store])

  const onRoomPermissionChange = useCallback(async (key: "memberCanControlPlayback" | "memberCanManageQueue" | "memberCanImportPlaylist", checked: boolean) => {
    const data = store.getState().pageData
    if (!data.amIOwner) return
    const permissions = { ...data.permissions, [key]: checked }
    const res = await requestSetRoomPermissions(data.roomId, nickNameRef.current, permissions)
    if (res?.code !== "0000") return window.alert(res?.showMsg || "权限设置保存失败，请稍后再试。")
    store.getState().applyRoomMeta(res.data, guestIdRef.current)
  }, [store])

  const onTransferOwner = useCallback(async (targetGuestId: string) => {
    const data = store.getState().pageData
    if (!data.amIOwner || !targetGuestId) return
    const target = data.participants.find(item => item.guestId === targetGuestId)
    if (!window.confirm(`确定把房主转让给 ${target?.nickName || "该成员"} 吗？`)) return
    const res = await requestTransferOwner(data.roomId, nickNameRef.current, targetGuestId)
    if (res?.code !== "0000") return window.alert(res?.showMsg || "房主转让失败，请稍后再试。")
    store.getState().applyRoomMeta(res.data, guestIdRef.current)
  }, [store])

  const onRoomNameChange = useCallback(async (roomName: string) => {
    const data = store.getState().pageData
    if (!data.amIOwner) return
    const nextName = roomName.trim().slice(0, 30)
    if (!nextName) return window.alert("房间名称不能为空")
    const res = await requestSetRoomName(data.roomId, nickNameRef.current, nextName)
    if (res?.code !== "0000") return window.alert(res?.showMsg || "房间名称保存失败，请稍后再试。")
    store.getState().patchPageData({ roomName: res.data?.roomName || nextName })
  }, [store])

  const onDeleteRoom = useCallback(async () => {
    const data = store.getState().pageData
    if (!data.amIOwner || !data.isPersistent) return
    if (!window.confirm("删除后当前房间会失效，同房间用户将无法继续停留。确定删除吗？")) return
    const res = await requestDeleteRoom(data.roomId, nickNameRef.current)
    if (res?.code !== "0000") return window.alert(res?.showMsg || "只有房主可以删除这个房间。")
    window.alert("这个常驻房间已删除，即将返回首页。")
    navigate("/")
  }, [navigate, store])

  const toEditMyName = useCallback(async (newName: string) => {
    const data = store.getState().pageData
    if (data.state !== 3) return
    nickNameRef.current = newName
    store.getState().setParticipants(data.participants.map(item => item.isMe ? { ...item, nickName: newName } : item))
    await requestHeartbeat(data.roomId, newName)
    const userData = ptUtil.getUserData()
    userData.nickName = newName
    ptUtil.setUserData(userData)
  }, [store])

  useEffect(() => {
    void enterRoom()
    return () => {
      void leaveRoom(true)
    }
  }, [enterRoom, leaveRoom])

  return useMemo(() => ({
    pageData,
    toHome: () => navigate("/"),
    toContact: () => navigate("/contact"),
    toEditMyName,
    onQueueItemTap,
    onQueueAdvance,
    onQueueRemoveItem,
    onQueueSkipCurrent,
    onQueuePlayNext,
    onPlayModeChange,
    onAppendQueueByLink,
    onCancelPlaylistImport,
    onTogglePlaylistImportPanel,
    onRoomPermissionChange,
    onTransferOwner,
    onRoomNameChange,
    onDeleteRoom,
  }), [
    navigate,
    onAppendQueueByLink,
    onCancelPlaylistImport,
    onDeleteRoom,
    onPlayModeChange,
    onQueueAdvance,
    onQueueItemTap,
    onQueuePlayNext,
    onQueueRemoveItem,
    onQueueSkipCurrent,
    onRoomNameChange,
    onRoomPermissionChange,
    onTogglePlaylistImportPanel,
    onTransferOwner,
    pageData,
    toEditMyName,
  ])
}

function contentToQueueItems(content: ContentData): QueueItem[] {
  if (content.queue?.items?.length) return content.queue.items
  return [{
    id: `${content.sourceType || "audio"}:${content.linkUrl || content.audioUrl}`,
    sourceType: content.sourceType || "audio",
    title: content.title || content.seriesName || "音频",
    artist: content.seriesName || "",
    imageUrl: content.imageUrl || "",
    linkUrl: content.linkUrl || "",
    audioUrl: content.audioUrl,
  }]
}
