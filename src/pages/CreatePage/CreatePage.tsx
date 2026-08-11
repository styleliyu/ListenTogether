import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import PtButton from "../../components/PtButton"
import ListeningLoader from "../../components/ListeningLoader"
import { createRoom, parseText, uploadAudio } from "../../services/apiClient"
import util from "../../utils/util"
import { LOCAL_MUSIC_ACCEPT, prepareLocalMusicFilesForUpload, releaseDecryptedMusicFile } from "../../utils/decryptMusicFile"
import type { ContentData, LocalImportFailure } from "../../types"
import "./createPage.css"

type CreateStatus = "idle" | "parsing" | "creating" | "reading" | "uploading"

const statusText: Record<Exclude<CreateStatus, "idle">, string> = {
  parsing: "正在解析链接…",
  creating: "正在创建房间…",
  reading: "正在读取本地音乐…",
  uploading: "正在上传音乐…",
}

export default function CreatePage() {
  const [inputValue, setInputValue] = useState("")
  const [isPersistent, setIsPersistent] = useState(false)
  const [roomName, setRoomName] = useState("")
  const [creatingFromQuery, setCreatingFromQuery] = useState(false)
  const [status, setStatus] = useState<CreateStatus>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [partialFailures, setPartialFailures] = useState<LocalImportFailure[]>([])
  const [linkTouched, setLinkTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const handledQueryRef = useRef<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const busy = status !== "idle"
  const normalizedRoomName = useMemo(() => isPersistent ? roomName.trim().slice(0, 30) : "", [isPersistent, roomName])
  const roomNameHasError = isPersistent && roomName.length > 0 && !roomName.trim()
  const linkIsValid = useMemo(() => {
    const value = inputValue.trim()
    if (value.length < 10) return false
    return /^https?:\/\/[\w.-]*\w{1,32}\.\w{2,6}\S*$/i.test(value)
  }, [inputValue])
  const canSubmit = linkIsValid && !roomNameHasError
  const linkHasError = linkTouched && inputValue.trim().length > 0 && !linkIsValid

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const targetLink = getTargetLink(params)
    if (!targetLink) {
      inputRef.current?.focus()
      return
    }
    if (handledQueryRef.current === location.search) return
    handledQueryRef.current = location.search
    setCreatingFromQuery(true)
    void createByLink(targetLink, true)
  }, [location.search])

  const setPageError = (message: string, fromQuery = false) => {
    setErrorMessage(message)
    setPartialFailures([])
    if (fromQuery) navigate("/create", { replace: true })
  }

  const createByContent = async (content: ContentData, fromQuery = false) => {
    setStatus("creating")
    const res = await createRoom(content, isPersistent, normalizedRoomName)
    if (res?.code !== "0000" || !res.data?.roomId) {
      setPageError(fromQuery
        ? "创建房间失败，不妨手动粘贴单集链接以创建房间。"
        : "房间创建失败，请稍后重试或更换内容。", fromQuery)
      return
    }
    navigate(`/room/${encodeURIComponent(res.data.roomId)}`, { replace: true })
  }

  const createByLink = async (link: string, fromQuery = false) => {
    setErrorMessage("")
    setPartialFailures([])
    setStatus("parsing")
    try {
      const res = await parseText(link)
      if (res?.code !== "0000" || !res.data) {
        setPageError(fromQuery
          ? "创建房间失败，不妨手动粘贴单集链接以创建房间。"
          : "解析失败，请稍后重新尝试或更换链接。", fromQuery)
        return
      }
      await createByContent(res.data, fromQuery)
    }
    catch (err) {
      setPageError(err instanceof Error ? err.message : "解析链接失败，请稍后重试。", fromQuery)
    }
    finally {
      setStatus("idle")
      setCreatingFromQuery(false)
    }
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit || busy) return
    setLinkTouched(true)
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
    setErrorMessage("")
    setPartialFailures([])
    setStatus("reading")
    try {
      const nextPrepared = await prepareLocalMusicFilesForUpload(files)
      prepared.files = nextPrepared.files
      prepared.decrypted = nextPrepared.decrypted
      prepared.metadata = nextPrepared.metadata
      prepared.failures = nextPrepared.failures

      if (!prepared.files.length) {
        setPageError(formatImportFailures(prepared.failures) || "没有可导入的本地音频文件。")
        return
      }

      setStatus("uploading")
      const res = await uploadAudio(prepared.files, prepared.metadata)
      const failures = [...prepared.failures, ...(res.data?.failures || [])]
      if (res?.code !== "0000" || !res.data?.content?.audioUrl) {
        setPageError(res.showMsg || formatImportFailures(failures) || "本地音频上传失败，请确认文件格式后重试。")
        return
      }
      if (failures.length) {
        setPartialFailures(failures)
        window.alert(`部分文件未导入：\n${formatImportFailures(failures)}`)
      }
      await createByContent(res.data.content)
    }
    catch (err) {
      setPageError(err instanceof Error ? err.message : "本地文件解析失败，请确认文件格式后重试。")
    }
    finally {
      prepared.decrypted.forEach(releaseDecryptedMusicFile)
      setStatus("idle")
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const currentStatusText = creatingFromQuery
    ? "正在根据分享内容创建房间…"
    : status === "idle" ? "" : statusText[status]

  return (
    <>
      <form className="page create-page" onSubmit={submit} aria-labelledby="create-page-title">
        <main className="page-container create-container">
          <header className="create-header">
            <button className="create-back" type="button" onClick={() => navigate("/")}>
              <span aria-hidden="true">←</span>
              <span>回首页</span>
            </button>
            <div className="create-kicker">
              <span className="create-kicker-dot" aria-hidden="true" />
              一起听 · 安静地开始
            </div>
            <h1 id="create-page-title">创建房间</h1>
            <p>先选择想一起听的内容，再决定这次房间要停留多久。</p>
          </header>

          <div className="create-layout">
            <section className="create-panel source-panel" aria-labelledby="source-panel-title">
              <div className="panel-heading">
                <span className="panel-step" aria-hidden="true">01</span>
                <div>
                  <h2 id="source-panel-title">添加要听的内容</h2>
                  <p>链接适合快速开始，本地音乐也可以直接带进来。</p>
                </div>
              </div>

              <div className="source-block link-source">
                <div className="source-label-row">
                  <span className="source-mark source-mark-link" aria-hidden="true">↗</span>
                  <div>
                    <h3>音乐、歌单或播客链接</h3>
                    <p>解析后会自动进入新房间</p>
                  </div>
                </div>
                <label className="field-label" htmlFor="content-link">内容链接</label>
                <input
                  ref={inputRef}
                  id="content-link"
                  className={`create-input link-input${linkHasError ? " has-error" : ""}`}
                  value={inputValue}
                  placeholder="粘贴完整的 http 或 https 链接"
                  type="url"
                  maxLength={1000}
                  autoComplete="url"
                  disabled={busy}
                  aria-invalid={linkHasError}
                  aria-describedby="content-link-help content-link-error"
                  onChange={event => {
                    setInputValue(event.target.value)
                    setLinkTouched(true)
                    if (errorMessage) setErrorMessage("")
                  }}
                />
                <p id="content-link-help" className="field-help">支持单曲、歌单和播客链接，创建后再邀请朋友加入。</p>
                <p id="content-link-error" className={`field-error${linkHasError ? " is-visible" : ""}`} role="alert">
                  {linkHasError ? "请输入完整的 http 或 https 链接。" : ""}
                </p>
                <PtButton
                  text={status === "parsing" ? "正在解析…" : status === "creating" ? "正在创建…" : "解析并创建房间"}
                  className="create-primary-action"
                  onClick={() => submit()}
                  disabled={!canSubmit || busy}
                />
              </div>

              <div className="source-divider" role="separator" aria-label="或">
                <span>或</span>
              </div>

              <div className="source-block local-source">
                <div className="source-label-row">
                  <span className="source-mark source-mark-local" aria-hidden="true">♪</span>
                  <div>
                    <h3>导入本地音乐</h3>
                    <p>普通音频与加密音乐都可以尝试</p>
                  </div>
                </div>
                <input
                  ref={fileRef}
                  className="file-input"
                  type="file"
                  accept={LOCAL_MUSIC_ACCEPT}
                  multiple
                  disabled={busy}
                  onChange={onFileChange}
                />
                <PtButton
                  text={status === "reading" ? "正在读取…" : status === "uploading" ? "正在上传…" : "选择本地歌曲"}
                  type="other"
                  className="local-import-action"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                />
                <p className="field-help local-help">支持 mp3、m4a、flac、wav、ogg，以及 ncm / qmc / kgm / kwm 等加密文件。</p>
              </div>
            </section>

            <section className="create-panel settings-panel" aria-labelledby="settings-panel-title">
              <div className="panel-heading">
                <span className="panel-step" aria-hidden="true">02</span>
                <div>
                  <h2 id="settings-panel-title">房间设置</h2>
                  <p>默认是临时房间，需要时再让它一直保留。</p>
                </div>
              </div>

              <div className="persistent-card">
                <label className="persistent-toggle" htmlFor="persistent-room">
                  <span className="toggle-copy">
                    <strong>常驻房间</strong>
                    <small>适合反复回来继续听</small>
                  </span>
                  <input
                    id="persistent-room"
                    type="checkbox"
                    checked={isPersistent}
                    disabled={busy}
                    onChange={event => setIsPersistent(event.target.checked)}
                  />
                  <span className="toggle-track" aria-hidden="true"><span /></span>
                </label>

                {isPersistent && (
                  <div className="room-name-field">
                    <label className="field-label" htmlFor="room-name">房间名称 <span>（可选）</span></label>
                    <input
                      id="room-name"
                      value={roomName}
                      className={`create-input room-name-input${roomNameHasError ? " has-error" : ""}`}
                      placeholder="例如：周五夜听"
                      maxLength={30}
                      type="text"
                      disabled={busy}
                      aria-invalid={roomNameHasError}
                      aria-describedby="room-name-help room-name-error"
                      onChange={event => setRoomName(event.target.value)}
                    />
                    <p id="room-name-help" className="field-help room-name-help">最多 30 个字符，留空也可以。</p>
                    <p id="room-name-error" className={`field-error${roomNameHasError ? " is-visible" : ""}`} role="alert">
                      {roomNameHasError ? "房间名称不能只有空格。" : ""}
                    </p>
                  </div>
                )}
              </div>

              <div className="settings-note">
                <span className="note-icon" aria-hidden="true">⌁</span>
                <p>创建完成后会进入独立的房间页面，播放器、队列和成员协作都在那里进行。</p>
              </div>
            </section>
          </div>

          <div className="create-feedback-stack" aria-live="polite">
            {currentStatusText && !creatingFromQuery && (
              <div className="create-status" role="status">
                <span className="status-dot" aria-hidden="true" />
                <span>{currentStatusText}</span>
              </div>
            )}
            {errorMessage && (
              <div className="create-feedback create-feedback-error" role="alert">
                <span className="feedback-icon" aria-hidden="true">!</span>
                <p>{errorMessage}</p>
                <button type="button" className="feedback-dismiss" onClick={() => setErrorMessage("")} aria-label="关闭错误提示">×</button>
              </div>
            )}
            {partialFailures.length > 0 && (
              <div className="create-feedback create-feedback-warning" role="status">
                <span className="feedback-icon" aria-hidden="true">!</span>
                <div>
                  <strong>部分文件未导入</strong>
                  <p>{formatImportFailures(partialFailures)}</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </form>

      {creatingFromQuery && (
        <div className="page-full create-full" role="status" aria-live="polite" aria-label="正在根据分享内容创建房间">
          <div className="query-progress-panel">
            <ListeningLoader />
            <p>{currentStatusText || "正在根据分享内容创建房间…"}</p>
            <span>请稍候，完成后会自动进入房间。</span>
          </div>
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
