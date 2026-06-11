import { useCallback, useMemo, useRef } from "react"
import util from "../utils/util"
import type { WsMsgRes } from "../types"

interface WsCallbacks {
  onMessage: (res: WsMsgRes) => void
  onClose?: (res: CloseEvent) => void
}

export function useRoomWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)

  const connect = useCallback((callbacks: WsCallbacks) => {
    const { WEBSOCKET_URL } = util.getEnv()
    const ws = new WebSocket(WEBSOCKET_URL)
    wsRef.current = ws

    ws.onmessage = (res) => {
      const msgRes = util.strToObj<WsMsgRes>(res.data)
      if (!msgRes?.responseType) return
      callbacks.onMessage(msgRes)
    }
    ws.onclose = (event) => callbacks.onClose?.(event)
    ws.onerror = (event) => {
      console.log("ws.onerror.......")
      console.log(event)
      console.log(" ")
    }

    return ws
  }, [])

  const close = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  const send = useCallback((obj: Record<string, any>): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify(obj))
      return true
    }
    catch (err) {
      console.log("使用 web-socket 发送消息失败.......")
      console.log(err)
      console.log(" ")
      return false
    }
  }, [])

  return useMemo(() => ({ wsRef, connect, close, send }), [close, connect, send])
}
