import { useCallback, useMemo, useRef } from "react"
import util from "../utils/util"

export function useHeartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback((callback: () => void | Promise<void>) => {
    const env = util.getEnv()
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      void callback()
    }, env.HEARTBEAT_PERIOD * 1000)
  }, [])

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
  }, [])

  return useMemo(() => ({ start, stop }), [start, stop])
}
