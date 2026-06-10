import { useCallback } from "react"
import type { PageData } from "../types"

export function useRoomPermissions(getPageData: () => PageData) {
  const canControlPlayback = useCallback(() => {
    const data = getPageData()
    return data.amIOwner || data.permissions.memberCanControlPlayback
  }, [getPageData])

  const canManageQueue = useCallback(() => {
    const data = getPageData()
    return data.amIOwner || data.permissions.memberCanManageQueue
  }, [getPageData])

  const canImportPlaylist = useCallback(() => {
    const data = getPageData()
    return data.amIOwner || data.permissions.memberCanImportPlaylist
  }, [getPageData])

  const showOperateFailed = useCallback((content = "你没有权限执行这个操作。") => {
    window.alert(content)
  }, [])

  return {
    canControlPlayback,
    canManageQueue,
    canImportPlaylist,
    showOperateFailed,
  }
}
