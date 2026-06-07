import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import PtButton from "../../components/PtButton"
import ListeningLoader from "../../components/ListeningLoader"
import { createRoom, parseText, uploadAudio } from "../../services/apiClient"
import util from "../../utils/util"
import { LOCAL_MUSIC_ACCEPT, prepareLocalMusicFilesForUpload, releaseDecryptedMusicFile } from "../../utils/decryptMusicFile"
import type { ContentData, LocalImportFailure } from "../../types"
import "./createPage.css"

export default function CreatePage() {
  const [inputValue, setInputValue] = useState("")
  const [isPersistent, setIsPersistent] = useState(false)
  const [roomName, setRoomName] = useState("")
  const [creatingFromQuery, setCreatingFromQuery] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const normalizedRoomName = useMemo(() => isPersistent ? roomName.trim().slice(0, 30) : "", [isPersistent, roomName])
  const canSubmit = useMemo(() => {
    const value = inputValue.trim()
    if (value.length < 10) return false
    if (isPersistent && roomName.length > 0 && !roomName.trim()) return false
    return /^http(s)?:\/\/[\w.-]*\w{1,32}\.\w{2,6}\S*$/g.test(value)
  }, [inputValue, isPersistent, roomName])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const targetLink = getTargetLink(params)
    if (!targetLink) {
      inputRef.current?.focus()
      return
    }
    setCreatingFromQuery(true)
    void createByLink(targetLink, true)
  }, [location.search])

  const showError = (message: string) => {
    window.alert(message)
  }

  const createByContent = async (content: ContentData, fromQuery = false) => {
    const res = await createRoom(content, isPersistent, normalizedRoomName)
    if (res?.code !== "0000" || !res.data?.roomId) {
      showError(fromQuery ? "创建房间失败，不妨手动黏贴单集链接以创建房间。" : "解析失败，请稍后重新尝试或更换链接。")
      if (fromQuery) navigate("/create", { replace: true })
      return
    }
    navigate(`/room/${encodeURIComponent(res.data.roomId)}`, { replace: true })
  }

  const createByLink = async (link: string, fromQuery = false) => {
    setBusy(true)
    try {
      const res = await parseText(link)
      if (res?.code !== "0000" || !res.data) {
        showError(fromQuery ? "创建房间失败，不妨手动黏贴单集链接以创建房间。" : "解析失败，请稍后重新尝试或更换链接。")
        if (fromQuery) navigate("/create", { replace: true })
        return
      }
      await createByContent(res.data, fromQuery)
    }
    finally {
      setBusy(false)
      setCreatingFromQuery(false)
    }
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit || busy) return
    inputRef.current?.blur()
    void createByLink(inputValue.trim())
  }

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (!files.length || busy) return
    const prepared = {
      files,
      decrypted: [] as Awaited<ReturnType<typeof prepareLocalMusicFilesForUpload>>["decrypted"],
      metadata: [] as Awaited<ReturnType<typeof prepareLocalMusicFilesForUpload>>["metadata"],
      failures: [] as Awaited<ReturnType<typeof prepareLocalMusicFilesForUpload>>["failures"],
    }
    setBusy(true)
    try {
      const nextPrepared = await prepareLocalMusicFilesForUpload(files)
      prepared.files = nextPrepared.files
      prepared.decrypted = nextPrepared.decrypted
      prepared.metadata = nextPrepared.metadata
      prepared.failures = nextPrepared.failures

      if (!prepared.files.length) {
        showError(formatImportFailures(prepared.failures) || "没有可导入的本地音频文件。")
        return
      }

      const res = await uploadAudio(prepared.files, prepared.metadata)
      const failures = [...prepared.failures, ...(res.data?.failures || [])]
      if (res?.code !== "0000" || !res.data?.content?.audioUrl) {
        showError(res.showMsg || formatImportFailures(failures) || "本地音频上传失败，请确认文件格式后重试。")
        return
      }
      if (failures.length) window.alert(`部分文件未导入：\n${formatImportFailures(failures)}`)
      await createByContent(res.data.content)
    }
    catch (err) {
      showError(err instanceof Error ? err.message : "本地文件解析失败，请确认文件格式后重试。")
    }
    finally {
      prepared.decrypted.forEach(releaseDecryptedMusicFile)
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <>
      <form className="page" onSubmit={submit}>
        <div className="page-container create-container">
          <h1>创建房间</h1>
          <input
            ref={inputRef}
            value={inputValue}
            placeholder="粘贴音频或音乐链接"
            type="url"
            maxLength={1000}
            onChange={event => setInputValue(event.target.value)}
          />
          <p>支持播客、音乐链接、歌单链接、本地普通音频，以及 ncm/qmc/kgm/kwm 等加密音乐文件</p>
          <label className="persistent-row">
            <input type="checkbox" checked={isPersistent} onChange={event => setIsPersistent(event.target.checked)} />
            <span>常驻房间</span>
          </label>
          {isPersistent && (
            <input
              value={roomName}
              className="room-name-input"
              placeholder="常驻房间名称，可不填"
              maxLength={30}
              type="text"
              onChange={event => setRoomName(event.target.value)}
            />
          )}
          <input
            ref={fileRef}
            className="file-input"
            type="file"
            accept={LOCAL_MUSIC_ACCEPT}
            multiple
            onChange={onFileChange}
          />
          <div className="create-actions">
            <PtButton text={busy ? "处理中..." : "确定"} onClick={() => submit()} disabled={!canSubmit || busy} />
            <PtButton text="回首页" type="other" onClick={() => navigate("/")} />
            <PtButton text="导入本地歌曲" type="other" onClick={() => fileRef.current?.click()} disabled={busy} />
          </div>
        </div>
      </form>

      {creatingFromQuery && (
        <div className="page-full create-full">
          <ListeningLoader />
          <div className="pf-text"><span>正在创建房间..</span></div>
        </div>
      )}
    </>
  )
}

function getTargetLink(params: URLSearchParams): string {
  const keys = ["link", "text", "title"]
  for (const key of keys) {
    const value = params.get(key)
    if (!value) continue
    const urls = util.getUrls(value)
    if (urls.length > 0) return urls[0]
  }
  return ""
}

function formatImportFailures(failures: LocalImportFailure[]): string {
  if (!failures.length) return ""
  const visible = failures.slice(0, 5).map(item => `${item.filename}：${item.reason}`).join("\n")
  const hidden = failures.length > 5 ? `\n还有 ${failures.length - 5} 个文件未导入。` : ""
  return `${visible}${hidden}`
}
