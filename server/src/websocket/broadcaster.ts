import WebSocket from "ws"
import type { PlaylistImportProgress, PtWebSocket, ResToFe, RoomPermissionConfig, RoomStatus } from "../types"

interface RoomInfoPayload {
  roomId: string
  roomName?: string
  deleted?: boolean
  ownerGuestId?: string
  everyoneCanOperatePlayer?: "Y" | "N"
  permissions?: RoomPermissionConfig
}

class WebSocketBroadcaster {
  private readonly sockets = new Set<PtWebSocket>()

  add(socket: PtWebSocket): void {
    this.sockets.add(socket)
  }

  remove(socket: PtWebSocket): void {
    this.sockets.delete(socket)
  }

  send(socket: PtWebSocket, data: ResToFe): void {
    if (socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(data))
  }

  broadcastToRoom = (roomId: string, data: ResToFe): void => {
    for (const socket of this.sockets) {
      if (socket.roomId === roomId) this.send(socket, data)
    }
  }

  broadcastRoomStatus(roomId: string, status: RoomStatus): void {
    this.broadcastToRoom(roomId, {
      responseType: "NEW_STATUS",
      roomStatus: status
    })
  }

  broadcastRoomInfo(roomId: string, info: RoomInfoPayload): void {
    this.broadcastToRoom(roomId, {
      responseType: "ROOM_INFO",
      roomInfo: info
    })
  }

  broadcastPlaylistImportProgress(roomId: string, progress: PlaylistImportProgress): void {
    this.broadcastToRoom(roomId, {
      responseType: "PLAYLIST_IMPORT_PROGRESS",
      playlistImportProgress: progress
    })
  }

  broadcastRoomDeleted(roomId: string): void {
    this.broadcastToRoom(roomId, {
      responseType: "ROOM_INFO",
      roomInfo: { roomId, deleted: true }
    })
  }
}

export const broadcaster = new WebSocketBroadcaster()
