import { create } from "zustand"
import type {
  ContentData,
  PageData,
  PageParticipant,
  PageState,
  PlaylistImportProgress,
  RoRes,
  RoomPermissionConfig,
  RoomQueue,
  RoomRole,
} from "../types"

export const DEFAULT_ROOM_PERMISSIONS: RoomPermissionConfig = {
  memberCanControlPlayback: true,
  memberCanManageQueue: true,
  memberCanImportPlaylist: true,
}

const initialPageData: PageData = {
  state: 1,
  roomId: "",
  roomName: "",
  isPersistent: false,
  participants: [],
  showMoreBox: false,
  amIOwner: false,
  roomRole: "member",
  ownerGuestId: "",
  everyoneCanOperatePlayer: "Y",
  permissions: { ...DEFAULT_ROOM_PERMISSIONS },
  queue: undefined,
  playlistImportMessage: "",
  playlistImportProgress: undefined,
  playlistImportCollapsed: false,
  cancellingPlaylistImport: false,
}

interface RoomStoreState {
  pageData: PageData
  setPageState: (state: PageState) => void
  setRoomId: (roomId: string) => void
  setContent: (content?: ContentData) => void
  setQueue: (queue?: RoomQueue) => void
  setParticipants: (participants: PageParticipant[]) => void
  patchPageData: (patch: Partial<PageData>) => void
  applyPermissions: (permissions?: RoomPermissionConfig, legacy?: "Y" | "N") => void
  applyOwnerGuestId: (ownerGuestId?: string, guestId?: string) => void
  applyRoomMeta: (roRes?: Partial<RoRes>, guestId?: string) => void
  updatePlaylistImportProgress: (progress: PlaylistImportProgress, touched: boolean) => void
  reset: () => void
}

export const useRoomStore = create<RoomStoreState>((set, get) => ({
  pageData: { ...initialPageData, permissions: { ...DEFAULT_ROOM_PERMISSIONS } },
  setPageState: (state) => set(({ pageData }) => ({ pageData: { ...pageData, state } })),
  setRoomId: (roomId) => set(({ pageData }) => ({ pageData: { ...pageData, roomId } })),
  setContent: (content) => set(({ pageData }) => ({ pageData: { ...pageData, content } })),
  setQueue: (queue) => set(({ pageData }) => ({ pageData: { ...pageData, queue } })),
  setParticipants: (participants) => set(({ pageData }) => ({ pageData: { ...pageData, participants } })),
  patchPageData: (patch) => set(({ pageData }) => ({ pageData: { ...pageData, ...patch } })),
  applyPermissions: (permissions, legacy) => {
    const legacyAllowed = legacy === "N" ? false : true
    const nextPermissions: RoomPermissionConfig = {
      memberCanControlPlayback: permissions?.memberCanControlPlayback ?? legacyAllowed,
      memberCanManageQueue: permissions?.memberCanManageQueue ?? legacyAllowed,
      memberCanImportPlaylist: permissions?.memberCanImportPlaylist ?? legacyAllowed,
    }
    set(({ pageData }) => ({
      pageData: {
        ...pageData,
        permissions: nextPermissions,
        everyoneCanOperatePlayer: nextPermissions.memberCanControlPlayback ? "Y" : "N",
      },
    }))
  },
  applyOwnerGuestId: (ownerGuestId, guestId) => {
    if (typeof ownerGuestId !== "string") return
    const amIOwner = Boolean(guestId && ownerGuestId === guestId)
    set(({ pageData }) => ({
      pageData: {
        ...pageData,
        ownerGuestId,
        amIOwner,
        roomRole: amIOwner ? "owner" : "member",
      },
    }))
  },
  applyRoomMeta: (roRes, guestId) => {
    if (!roRes) return
    const { applyPermissions, applyOwnerGuestId } = get()
    set(({ pageData }) => {
      let roomRole: RoomRole = pageData.roomRole
      let amIOwner = pageData.amIOwner
      if (roRes.iamOwner) {
        amIOwner = roRes.iamOwner === "Y"
        roomRole = amIOwner ? "owner" : "member"
      }
      if (roRes.roomRole) {
        roomRole = roRes.roomRole
        amIOwner = roomRole === "owner"
      }
      return {
        pageData: {
          ...pageData,
          roomName: typeof roRes.roomName === "string" ? roRes.roomName : pageData.roomName,
          isPersistent: typeof roRes.isPersistent === "boolean" ? Boolean(roRes.isPersistent) : pageData.isPersistent,
          roomRole,
          amIOwner,
        },
      }
    })
    applyPermissions(roRes.permissions, roRes.everyoneCanOperatePlayer)
    applyOwnerGuestId(roRes.ownerGuestId, guestId)
  },
  updatePlaylistImportProgress: (progress, touched) => {
    let collapsed = get().pageData.playlistImportCollapsed
    if (progress.status === "started") collapsed = false
    else if (progress.status === "progress") collapsed = touched ? collapsed : false
    else collapsed = touched ? collapsed : true

    set(({ pageData }) => ({
      pageData: {
        ...pageData,
        playlistImportProgress: progress,
        playlistImportMessage: progress.message,
        playlistImportCollapsed: collapsed,
      },
    }))
  },
  reset: () => set({ pageData: { ...initialPageData, permissions: { ...DEFAULT_ROOM_PERMISSIONS } } }),
}))
