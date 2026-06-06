import rq from "../../../request"
import { ContentData, RequestRes, RoRes, RoomPermissionConfig } from "../../../type"
import api from "../../../request/api"

const url = api.ROOM_OPERATE

// 请求进入房间
export const request_enter = async(roomId: string, nickName: string): Promise<RequestRes<RoRes>> => {
  let param = { operateType: "ENTER", roomId, nickName }
  let res = await rq.request<RoRes>(url, param)
  return res
}

// 请求心跳
export const request_heartbeat = async(roomId: string, nickName: string): Promise<RequestRes<RoRes>> => {
  let param = { operateType: "HEARTBEAT", roomId, nickName }
  let res = await rq.request<RoRes>(url, param)
  return res
} 

// 请求离开
export const request_leave = async(roomId: string, nickName: string): Promise<RequestRes<RoRes>> => {
  let param = { operateType: "LEAVE", roomId, nickName }
  let res = await rq.request<RoRes>(url, param)
  return res
}

export const request_parse = async(link: string): Promise<RequestRes<ContentData>> => {
  let res = await rq.request<ContentData>(api.PARSE_TEXT, { link })
  return res
}

export const request_cancel_playlist_import = async(roomId: string): Promise<RequestRes> => {
  let res = await rq.request(api.PLAYLIST_IMPORT_CANCEL, { roomId })
  return res
}

export const request_set_room_name = async(roomId: string, nickName: string, roomName: string): Promise<RequestRes<RoRes>> => {
  let param = { operateType: "SET_ROOM_NAME", roomId, nickName, roomName }
  let res = await rq.request<RoRes>(url, param)
  return res
}

export const request_delete_room = async(roomId: string, nickName: string): Promise<RequestRes<RoRes>> => {
  let param = { operateType: "DELETE_ROOM", roomId, nickName }
  let res = await rq.request<RoRes>(url, param)
  return res
}

export const request_set_room_permissions = async(
  roomId: string,
  nickName: string,
  permissions: RoomPermissionConfig
): Promise<RequestRes<RoRes>> => {
  let param = { operateType: "SET_ROOM_PERMISSIONS", roomId, nickName, permissions }
  let res = await rq.request<RoRes>(url, param)
  return res
}

export const request_transfer_owner = async(
  roomId: string,
  nickName: string,
  targetGuestId: string
): Promise<RequestRes<RoRes>> => {
  let param = { operateType: "TRANSFER_OWNER", roomId, nickName, targetGuestId }
  let res = await rq.request<RoRes>(url, param)
  return res
}
