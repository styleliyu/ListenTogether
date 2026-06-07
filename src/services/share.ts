import QRCode from "qrcode"
import ptApi from "../utils/pt-api"

export function buildRoomShareUrl(roomId: string): string {
  const url = new URL(window.location.href)
  url.pathname = `/room/${encodeURIComponent(roomId)}`
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function createRoomQrCode(shareUrl: string): Promise<string> {
  return QRCode.toDataURL(shareUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 260,
    color: {
      dark: "#111111",
      light: "#ffffff",
    },
  })
}

export async function copyShareLink(shareUrl: string): Promise<boolean | undefined> {
  return ptApi.copyToClipboard(shareUrl)
}

export async function nativeShareOrCopy(data: ShareData): Promise<boolean | undefined> {
  if (ptApi.canShare(data)) {
    const shared = await ptApi.share(data)
    if (shared) return true
  }
  return copyShareLink(data.url || "")
}
