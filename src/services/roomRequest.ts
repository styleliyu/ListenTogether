import api from "./endpoints"
import { request } from "./request"
import type { ContentData, RequestRes, RoRes, RoomPermissionConfig } from "../types"

const roomOperateUrl = api.ROOM_OPERATE

export function requestEnter(roomId: string, nickName: string): Promise<RequestRes<RoRes>> {
  return request<RoRes>(roomOperateUrl, { operateType: "ENTER", roomId, nickName })
}

export function requestHeartbeat(roomId: string, nickName: string): Promise<RequestRes<RoRes>> {
  return request<RoRes>(roomOperateUrl, { operateType: "HEARTBEAT", roomId, nickName })
}

export function requestLeave(roomId: string, nickName: string): Promise<RequestRes<RoRes>> {
  return request<RoRes>(roomOperateUrl, { operateType: "LEAVE", roomId, nickName })
}

export function requestParse(link: string): Promise<RequestRes<ContentData>> {
  return request<ContentData>(api.PARSE_TEXT, { link })
}

export function requestCancelPlaylistImport(roomId: string): Promise<RequestRes> {
  return request(api.PLAYLIST_IMPORT_CANCEL, { roomId })
}

export function requestSetRoomName(roomId: string, nickName: string, roomName: string): Promise<RequestRes<RoRes>> {
  return request<RoRes>(roomOperateUrl, { operateType: "SET_ROOM_NAME", roomId, nickName, roomName })
}

export function requestDeleteRoom(roomId: string, nickName: string): Promise<RequestRes<RoRes>> {
  return request<RoRes>(roomOperateUrl, { operateType: "DELETE_ROOM", roomId, nickName })
}

export function requestSetRoomPermissions(
  roomId: string,
  nickName: string,
  permissions: RoomPermissionConfig,
): Promise<RequestRes<RoRes>> {
  return request<RoRes>(roomOperateUrl, {
    operateType: "SET_ROOM_PERMISSIONS",
    roomId,
    nickName,
    permissions,
  })
}

export function requestTransferOwner(
  roomId: string,
  nickName: string,
  targetGuestId: string,
): Promise<RequestRes<RoRes>> {
  return request<RoRes>(roomOperateUrl, {
    operateType: "TRANSFER_OWNER",
    roomId,
    nickName,
    targetGuestId,
  })
}
