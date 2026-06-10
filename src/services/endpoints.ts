import util from "../utils/util"

const apiUrl = `${util.getEnv().API_URL}/`

export default {
  ROOM_OPERATE: `${apiUrl}room-operate`,
  PARSE_TEXT: `${apiUrl}parse-text`,
  PLAYLIST_IMPORT_CANCEL: `${apiUrl}playlist-import/cancel`,
  UPLOAD_AUDIO: `${apiUrl}upload-audio`,
  PT_SERVICE: `${apiUrl}pt-service`,
}
