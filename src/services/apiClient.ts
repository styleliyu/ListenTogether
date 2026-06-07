import rq from "../request"
import api from "../request/api"
import ptUtil from "../utils/pt-util"
import type { ContentData, LocalUploadMetadata, RequestRes, RoRes, UploadAudioData } from "../types"

export async function parseText(link: string): Promise<RequestRes<ContentData>> {
  return rq.request<ContentData>(api.PARSE_TEXT, { link })
}

export async function createRoom(
  roomData: ContentData,
  isPersistent = false,
  roomName = "",
): Promise<RequestRes<RoRes>> {
  const userData = ptUtil.getUserData()
  return rq.request<RoRes>(api.ROOM_OPERATE, {
    operateType: "CREATE",
    roomData,
    nickName: userData.nickName,
    isPersistent,
    roomName,
  })
}

export async function uploadAudio(
  files: File[],
  metadata: LocalUploadMetadata[] = [],
): Promise<RequestRes<UploadAudioData>> {
  const formData = new FormData()
  for (const file of files) formData.append("files", file)
  formData.append("metadata", JSON.stringify(metadata))

  const response = await fetch(api.UPLOAD_AUDIO, {
    method: "POST",
    body: formData,
  })
  return await response.json() as RequestRes<UploadAudioData>
}
