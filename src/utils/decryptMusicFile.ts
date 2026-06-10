import { Buffer } from "buffer"
import type { DecryptResult, FileInfo } from "@decrypt-core/decrypt/entity"
import type { LocalImportFailure, LocalUploadMetadata } from "../types"

type DecryptModule = typeof import("@decrypt-core/decrypt")

const plainAudioExtensions = new Set(["mp3", "m4a", "aac", "flac", "wav", "ogg", "wma", "dff"])

const encryptedAudioExtensions = new Set([
  "mg3d",
  "ncm",
  "uc",
  "kwm",
  "xm",
  "tm0",
  "tm2",
  "tm3",
  "tm6",
  "qmc0",
  "qmc2",
  "qmc3",
  "qmc4",
  "qmc6",
  "qmc8",
  "qmcflac",
  "qmcogg",
  "tkm",
  "bkcmp3",
  "bkcm4a",
  "bkcflac",
  "bkcwav",
  "bkcape",
  "bkcogg",
  "bkcwma",
  "mggl",
  "mflac",
  "mflac0",
  "mflach",
  "mgg",
  "mgg0",
  "mgg1",
  "mmp4",
  "666c6163",
  "6d7033",
  "6f6767",
  "6d3461",
  "776176",
  "cache",
  "vpr",
  "kgm",
  "kgma",
  "ofl_en",
  "x2m",
  "x3m",
])

const outputMimeByExt: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  wma: "audio/x-ms-wma",
  dff: "audio/x-dff",
}

export const LOCAL_MUSIC_ACCEPT = [
  ...Array.from(plainAudioExtensions, ext => `.${ext}`),
  ...Array.from(encryptedAudioExtensions, ext => `.${ext}`),
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/wav",
  "audio/ogg",
].join(",")

export interface DecryptedMusicFile {
  title: string
  artist?: string
  album?: string
  ext: string
  mime: string
  blob: Blob
  objectUrl: string
  pictureUrl?: string
  rawFilename?: string
  rawExt?: string
  file: File
}

export interface PreparedLocalMusicFiles {
  files: File[]
  decrypted: DecryptedMusicFile[]
  metadata: LocalUploadMetadata[]
  failures: LocalImportFailure[]
}

let decryptModulePromise: Promise<DecryptModule> | null = null

export function isSupportedLocalMusicFile(file: File): boolean {
  const ext = getFileExtension(file.name)
  return plainAudioExtensions.has(ext) || encryptedAudioExtensions.has(ext) || file.type.startsWith("audio/")
}

export function isEncryptedMusicFile(file: File): boolean {
  return encryptedAudioExtensions.has(getFileExtension(file.name))
}

export async function decryptMusicFile(file: File): Promise<DecryptedMusicFile> {
  const { Decrypt } = await loadDecryptModule()
  const result = await Decrypt(createFileInfo(file), {})
  return toDecryptedMusicFile(file, result)
}

export async function prepareLocalMusicFilesForUpload(files: File[]): Promise<PreparedLocalMusicFiles> {
  const preparedFiles: File[] = []
  const decrypted: DecryptedMusicFile[] = []
  const metadata: LocalUploadMetadata[] = []
  const failures: LocalImportFailure[] = []

  for (const file of files) {
    try {
      const prepared = await prepareSingleLocalMusicFile(file)
      preparedFiles.push(prepared.file)
      metadata.push(prepared.metadata)
      if (prepared.decrypted) decrypted.push(prepared.decrypted)
    }
    catch(err) {
      failures.push({
        filename: file.name || "未命名文件",
        reason: toReadableImportError(err)
      })
    }
  }

  return {
    files: preparedFiles,
    decrypted,
    metadata,
    failures,
  }
}

export function releaseDecryptedMusicFile(result: DecryptedMusicFile): void {
  if (result.objectUrl) URL.revokeObjectURL(result.objectUrl)
  if (result.pictureUrl?.startsWith("blob:")) URL.revokeObjectURL(result.pictureUrl)
}

async function prepareSingleLocalMusicFile(file: File): Promise<{
  file: File
  metadata: LocalUploadMetadata
  decrypted?: DecryptedMusicFile
}> {
  if (!file.size) throw new Error("文件为空，无法导入。")

  if (isEncryptedMusicFile(file)) {
    const decryptedFile = await decryptMusicFile(file)
    const detectedExt = plainAudioExtensions.has(decryptedFile.ext)
      ? decryptedFile.ext
      : await sniffLocalAudioExt(decryptedFile.file)
    if (!detectedExt) throw new Error("解密后未识别出可播放音频格式。")
    if (!plainAudioExtensions.has(detectedExt)) throw new Error(`解密后音频格式不受支持：${detectedExt}`)

    const normalized = ensureFileExtension(decryptedFile.file, detectedExt, decryptedFile.mime)
    return {
      file: normalized,
      metadata: buildUploadMetadata(normalized, file.name, {
        title: decryptedFile.title,
        artist: decryptedFile.artist,
        album: decryptedFile.album,
        detectedExt,
        mime: decryptedFile.mime,
      }),
      decrypted: decryptedFile
    }
  }

  const detectedExt = await sniffLocalAudioExt(file)
  if (!detectedExt) {
    const ext = getFileExtension(file.name)
    if (plainAudioExtensions.has(ext)) throw new Error("文件扩展名受支持，但内容不是可识别的音频。")
    throw new Error("不支持的本地文件格式。")
  }

  const normalized = ensureFileExtension(file, detectedExt, outputMimeByExt[detectedExt])
  return {
    file: normalized,
    metadata: buildUploadMetadata(normalized, file.name, {
      title: removeExtension(file.name),
      detectedExt,
      mime: outputMimeByExt[detectedExt],
    })
  }
}

function buildUploadMetadata(
  file: File,
  originalName: string,
  input: {
    title?: string
    artist?: string
    album?: string
    detectedExt: string
    mime?: string
  }
): LocalUploadMetadata {
  const fallbackTitle = removeExtension(originalName || file.name)
  return {
    filename: file.name,
    originalName,
    title: normalizeMetaText(input.title) || normalizeMetaText(fallbackTitle) || "本地歌曲",
    artist: normalizeMetaText(input.artist),
    album: normalizeMetaText(input.album),
    detectedExt: input.detectedExt,
    mime: input.mime || file.type || outputMimeByExt[input.detectedExt],
  }
}

function loadDecryptModule(): Promise<DecryptModule> {
  ensureBuffer()
  if (!decryptModulePromise) {
    decryptModulePromise = import("@decrypt-core/decrypt")
  }
  return decryptModulePromise
}

function ensureBuffer(): void {
  const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  if (!scope.Buffer) scope.Buffer = Buffer
}

function createFileInfo(file: File): FileInfo {
  return {
    status: "ready",
    name: file.name,
    size: file.size,
    percentage: 0,
    uid: Date.now() + Math.floor(Math.random() * 100000),
    raw: file,
  }
}

function toDecryptedMusicFile(sourceFile: File, result: DecryptResult): DecryptedMusicFile {
  const rawName = normalizeMetaText(result.rawFilename) || removeExtension(sourceFile.name)
  const ext = normalizeExtension(result.ext || result.rawExt || "mp3")
  const mime = result.mime || outputMimeByExt[ext] || "application/octet-stream"
  const title = normalizeMetaText(result.title) || normalizeMetaText(rawName) || "本地歌曲"
  const filename = `${sanitizeFilename(title || rawName)}.${ext}`
  const file = new File([result.blob], filename, {
    type: mime,
    lastModified: Date.now(),
  })

  return {
    title,
    artist: normalizeMetaText(result.artist),
    album: normalizeMetaText(result.album),
    ext,
    mime,
    blob: result.blob,
    objectUrl: result.file,
    pictureUrl: result.picture,
    rawFilename: rawName,
    rawExt: result.rawExt,
    file,
  }
}

async function sniffLocalAudioExt(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  if (hasPrefix(buf, [0x49, 0x44, 0x33])) return "mp3"
  if (hasPrefix(buf, [0x66, 0x4c, 0x61, 0x43])) return "flac"
  if (hasPrefix(buf, [0x4f, 0x67, 0x67, 0x53])) return "ogg"
  if (buf.length >= 12 && hasPrefix(buf, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(buf.slice(8), [0x57, 0x41, 0x56, 0x45])) return "wav"
  if (buf.length >= 12 && hasPrefix(buf.slice(4), [0x66, 0x74, 0x79, 0x70])) return "m4a"
  if (hasPrefix(buf, [0xff, 0xf1]) || hasPrefix(buf, [0xff, 0xf9])) return "aac"
  if (isMp3Frame(buf)) return "mp3"
  if (hasPrefix(buf, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c])) return "wma"
  if (hasPrefix(buf, [0x46, 0x52, 0x4d, 0x38])) return "dff"
  return ""
}

function ensureFileExtension(file: File, ext: string, mime?: string): File {
  const currentExt = getFileExtension(file.name)
  const filename = currentExt === ext ? file.name : `${sanitizeFilename(removeExtension(file.name))}.${ext}`
  if (filename === file.name && (!mime || file.type === mime)) return file
  return new File([file], filename, {
    type: mime || outputMimeByExt[ext] || file.type,
    lastModified: file.lastModified || Date.now(),
  })
}

function hasPrefix(data: Uint8Array, prefix: number[]): boolean {
  if (prefix.length > data.length) return false
  return prefix.every((value, index) => data[index] === value)
}

function isMp3Frame(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0
}

function normalizeMetaText(value?: string): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const repaired = repairMojibake(trimmed).replace(/\s+/g, " ").trim()
  if (!repaired || looksLikeMojibake(repaired)) return undefined
  return repaired
}

function repairMojibake(value: string): string {
  if (!looksLikeMojibake(value)) return value
  const utf8 = decodeBinaryString(value, "utf-8")
  if (utf8 && !looksLikeMojibake(utf8)) return utf8
  const gb18030 = decodeBinaryString(value, "gb18030")
  if (gb18030 && !looksLikeMojibake(gb18030)) return gb18030
  return value
}

function looksLikeMojibake(value: string): boolean {
  if (/[�锟]/.test(value)) return true
  if (/[\u0080-\u009f]/.test(value) && /[\u00c0-\u00ff]/.test(value)) return true
  if (/[ÃãÂâ][\u0080-\u00bf\u00c0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u2018-\u201d\u201a-\u201e\u2020-\u2022\u2030\u2039-\u203a]/.test(value)) return true
  return /[äåæçèéêëìíîï][\u0080-\u00bf\u00a0-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u2018-\u201d\u201a-\u201e\u2020-\u2022\u2030\u2039-\u203a]/.test(value)
}

function decodeBinaryString(value: string, encoding: string): string {
  try {
    const bytes = Uint8Array.from(Array.from(value, windows1252Byte))
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  }
  catch {
    return ""
  }
}

function windows1252Byte(char: string): number {
  const code = char.charCodeAt(0)
  if (code <= 0xff) return code
  const mapped = windows1252SpecialBytes[code]
  return mapped ?? 0x3f
}

const windows1252SpecialBytes: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
}

function toReadableImportError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "")
  const message = stripHtml(raw).trim()
  if (!message) return "文件解析失败。"
  if (/unsupported|不支持此文件格式/i.test(message)) return "不支持的文件格式。"
  if (/damaged|损坏|invalid|bad sequence|not a valid/i.test(message)) return "文件可能已损坏或不是对应的音频格式。"
  if (/no cipher|密钥|无法解锁|key/i.test(message)) return "加密文件缺少密钥，无法在网页端解锁。"
  return message
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "")
}

function getFileExtension(filename: string): string {
  const pos = filename.lastIndexOf(".")
  if (pos < 0) return ""
  return normalizeExtension(filename.slice(pos + 1))
}

function normalizeExtension(ext: string): string {
  return ext.trim().replace(/^\./, "").toLowerCase()
}

function removeExtension(filename: string): string {
  const pos = filename.lastIndexOf(".")
  return pos > 0 ? filename.slice(0, pos) : filename
}

function sanitizeFilename(filename: string): string {
  return (normalizeMetaText(filename) || filename).replace(/[\\/:*?"<>|]+/g, "_").trim() || "local-audio"
}
