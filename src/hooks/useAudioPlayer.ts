import { RefObject, useCallback, useRef } from "react"
import Shikwasa from "shikwasa2"
import images from "../images"
import time from "../utils/time"
import util from "../utils/util"
import type { ContentData, PlayStatus, RevokeType, RoomQueue, RoomStatus } from "../types"

type PlayerInstance = any

interface PlayerCallbacks {
  durationchange?: (duration?: number) => void
  pause?: () => void
  playing?: () => void
  ratechange?: () => void
  seeked?: () => void
  ended?: () => void
  prev?: () => void
  next?: () => void
}

const throttleData = {
  canplay: 0,
  play: 0,
  pause: 0,
  speed: 0,
  seek: 0,
}

function checkThrottle(type: keyof typeof throttleData): boolean {
  const now = time.getLocalTime()
  if (now - throttleData[type] < 60) return false
  throttleData[type] = now
  return true
}

export function useAudioPlayer(playerEl: RefObject<HTMLElement>) {
  const playerRef = useRef<PlayerInstance | null>(null)
  const srcDurationRef = useRef(0)
  const playStatusRef = useRef<PlayStatus>("PAUSED")
  const localPlaybackRateRef = useRef(1)
  const readyTokenRef = useRef(0)
  const readyResolveRef = useRef<(value: boolean) => void>(() => undefined)
  const waitReadyRef = useRef<Promise<boolean>>(Promise.resolve(false))
  const remoteFlagsRef = useRef({
    seeking: false,
    playing: false,
    paused: false,
    speed: false,
  })

  const destroyPlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.destroy()
      playerRef.current = null
    }
  }, [])

  const markReady = useCallback((token: number) => {
    if (token !== readyTokenRef.current) return
    readyResolveRef.current(true)
  }, [])

  const createPlayer = useCallback((
    content: ContentData,
    callbacks: PlayerCallbacks,
    onBeforeClick: (target: string) => boolean,
  ) => {
    destroyPlayer()
    srcDurationRef.current = 0
    const readyToken = ++readyTokenRef.current
    waitReadyRef.current = new Promise(resolve => {
      readyResolveRef.current = resolve
    })

    const player = new Shikwasa({
      container: () => playerEl.current,
      audio: {
        src: content.audioUrl,
        title: content.title,
        cover: content.imageUrl || images.APP_LOGO,
        artist: content.seriesName,
      },
      themeColor: "var(--text-color)",
      speedOptions: [0.8, 1, 1.2, 1.5, 1.7],
      onBeforeClick,
    })
    playerRef.current = player
    patchSeekButtons(playerEl.current, callbacks)
    patchProgressDrag(playerEl.current, player, onBeforeClick)

    player.on("durationchange", (event: any) => {
      const audio = event?.path?.[0] || event?.srcElement
      const duration = audio?.duration
      if (duration) srcDurationRef.current = duration
      callbacks.durationchange?.(duration)
      markReady(readyToken)
    })
    player.on("canplay", () => {
      if (!checkThrottle("canplay")) return
      markReady(readyToken)
    })
    player.on("loadeddata", () => markReady(readyToken))
    player.on("pause", () => {
      if (!checkThrottle("pause")) return
      playStatusRef.current = "PAUSED"
      if (remoteFlagsRef.current.paused) {
        remoteFlagsRef.current.paused = false
        return
      }
      callbacks.pause?.()
    })
    player.on("playing", () => {
      if (!checkThrottle("play")) return
      playStatusRef.current = "PLAYING"
      if (remoteFlagsRef.current.playing) {
        remoteFlagsRef.current.playing = false
        return
      }
      callbacks.playing?.()
    })
    player.on("ratechange", () => {
      if (!checkThrottle("speed")) return
      if (remoteFlagsRef.current.speed) {
        remoteFlagsRef.current.speed = false
        return
      }
      localPlaybackRateRef.current = Number(player?.playbackRate || 1)
      callbacks.ratechange?.()
    })
    player.on("seeked", () => {
      if (!checkThrottle("seek")) return
      if (remoteFlagsRef.current.seeking) {
        remoteFlagsRef.current.seeking = false
        return
      }
      callbacks.seeked?.()
    })
    player.on("ended", () => callbacks.ended?.())

    return player
  }, [destroyPlayer, markReady, playerEl])

  const waitReady = useCallback(() => waitReadyRef.current, [])

  const seekByRemote = useCallback((sec: number) => {
    if (!playerRef.current) return
    remoteFlagsRef.current.seeking = true
    playerRef.current.seek(sec)
  }, [])

  const playByRemote = useCallback(() => {
    if (!playerRef.current) return
    remoteFlagsRef.current.playing = true
    playerRef.current.play()
  }, [])

  const pauseByRemote = useCallback(() => {
    if (!playerRef.current) return
    remoteFlagsRef.current.paused = true
    playerRef.current.pause()
  }, [])

  const applyLocalPlaybackRate = useCallback(() => {
    if (!playerRef.current) return
    const rate = localPlaybackRateRef.current
    if (rate && Number(playerRef.current.playbackRate) !== rate) {
      remoteFlagsRef.current.speed = true
      playerRef.current.playbackRate = rate
    }
  }, [])

  return {
    playerRef,
    srcDurationRef,
    playStatusRef,
    localPlaybackRateRef,
    createPlayer,
    destroyPlayer,
    waitReady,
    seekByRemote,
    playByRemote,
    pauseByRemote,
    applyLocalPlaybackRate,
  }
}

export function getRemoteCurrentTime(newStatus: RoomStatus, srcDuration: number): number {
  const { playStatus, contentStamp, operateStamp, speedRate } = newStatus
  if (playStatus === "PAUSED") return contentStamp
  const rate = Number(speedRate)
  const srcMs = srcDuration * 1000
  const now = time.getTime()
  const remoteMs = ((now - operateStamp) * rate) + contentStamp
  return remoteMs >= srcMs ? srcMs : remoteMs
}

export function getReSeek(
  latestStatus: RoomStatus,
  srcDuration: number,
  currentTime: number,
  revokeType: RevokeType,
): number {
  const threshold = latestStatus.playStatus === "PAUSED" ? 1001 : revokeType === "http" ? 2200 : 1100
  const remoteMs = getRemoteCurrentTime(latestStatus, srcDuration)
  const localMs = currentTime * 1000
  if (Math.abs(remoteMs - localMs) < threshold) return -1
  let currentSec = (remoteMs / 1000) + 0.1
  currentSec = util.numToFix(currentSec, 3)
  return currentSec > srcDuration ? srcDuration : currentSec
}

export function getPlayingTrackIdentity(content?: ContentData, queue?: RoomQueue) {
  const itemById = queue?.currentItemId
    ? queue.items.find(item => item.id === queue.currentItemId)
    : undefined
  const currentItem = itemById || queue?.items?.[queue.currentIndex]
  const audioUrl = currentItem?.audioUrl || content?.audioUrl || ""
  const id = queue?.currentItemId || currentItem?.id || `${content?.sourceType || "audio"}:${content?.linkUrl || audioUrl}`
  return { id, audioUrl, hasStableId: Boolean(queue?.currentItemId || currentItem?.id) }
}

export function isSamePlayingTrack(
  oldContent?: ContentData,
  oldQueue?: RoomQueue,
  newContent?: ContentData,
  newQueue?: RoomQueue,
): boolean {
  const oldTrack = getPlayingTrackIdentity(oldContent, oldQueue)
  const newTrack = getPlayingTrackIdentity(newContent, newQueue)
  if (
    oldTrack.audioUrl
    && newTrack.audioUrl
    && oldTrack.audioUrl === newTrack.audioUrl
    && (!oldTrack.hasStableId || !newTrack.hasStableId)
  ) {
    return true
  }
  return oldTrack.id === newTrack.id && oldTrack.audioUrl === newTrack.audioUrl
}

export function isSameQueueItems(a?: RoomQueue, b?: RoomQueue): boolean {
  if (!a || !b) return a === b
  if (a.currentIndex !== b.currentIndex) return false
  if ((a.currentItemId || "") !== (b.currentItemId || "")) return false
  if (a.items.length !== b.items.length) return false
  return a.items.every((item, index) => {
    const next = b.items[index]
    return item.id === next.id && (item.audioUrl || "") === (next.audioUrl || "")
  })
}

function patchSeekButtons(container: HTMLElement | null, callbacks: PlayerCallbacks): void {
  if (!container) return
  patchQueueButton(container.querySelector<HTMLButtonElement>(".shk-btn_backward"), "上一首", prevIcon(), () => callbacks.prev?.())
  patchQueueButton(container.querySelector<HTMLButtonElement>(".shk-btn_forward"), "下一首", nextIcon(), () => callbacks.next?.())
}

function patchQueueButton(btn: HTMLButtonElement | null, label: string, icon: string, callback: () => void): void {
  if (!btn) return
  btn.title = label
  btn.setAttribute("aria-label", label)
  btn.innerHTML = icon
  btn.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    callback()
  }, true)
}

function patchProgressDrag(container: HTMLElement | null, player: PlayerInstance, onBeforeClick: (target: string) => boolean): void {
  if (!container) return
  const bar = container.querySelector<HTMLElement>(".shk-bar_wrap")
  if (!bar) return
  let dragging = false
  const seekByClientX = (clientX: number) => {
    if (!onBeforeClick("seek")) return
    const duration = Number(player.duration || player.audio?.duration || 0)
    if (!Number.isFinite(duration) || duration <= 0) return
    const rect = bar.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    player.seek(duration * percent)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (dragging) seekByClientX(event.clientX)
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return
    dragging = false
    seekByClientX(event.clientX)
    window.removeEventListener("pointermove", onPointerMove, true)
    window.removeEventListener("pointerup", onPointerUp, true)
  }
  bar.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    dragging = true
    seekByClientX(event.clientX)
    window.addEventListener("pointermove", onPointerMove, true)
    window.addEventListener("pointerup", onPointerUp, true)
  }, true)
}

function prevIcon(): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 10a4 4 0 0 1 4 4v14L48 10.8a4 4 0 0 1 6 3.5v35.4a4 4 0 0 1-6 3.5L18 36v14a4 4 0 0 1-8 0V14a4 4 0 0 1 4-4z"/></svg>`
}

function nextIcon(): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M50 10a4 4 0 0 0-4 4v14L16 10.8a4 4 0 0 0-6 3.5v35.4a4 4 0 0 0 6 3.5L46 36v14a4 4 0 0 0 8 0V14a4 4 0 0 0-4-4z"/></svg>`
}
