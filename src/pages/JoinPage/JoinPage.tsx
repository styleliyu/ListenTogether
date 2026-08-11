import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import PtButton from "../../components/PtButton"
import ptUtil from "../../utils/pt-util"
import "./joinPage.css"

export default function JoinPage() {
  const [inputValue, setInputValue] = useState("")
  const [hasBlurred, setHasBlurred] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const canSubmit = useMemo(() => inputValue.trim().length > 0, [inputValue])
  const roomId = useMemo(() => new URLSearchParams(location.search).get("roomId"), [location.search])
  const showWhitespaceError = hasBlurred && inputValue.length > 0 && !canSubmit

  useEffect(() => {
    if (window.matchMedia("(min-width: 601px)").matches) {
      inputRef.current?.focus()
    }
  }, [])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    setHasBlurred(true)
    if (!canSubmit) return
    const userData = ptUtil.getUserData()
    userData.nickName = inputValue.trim().slice(0, 20)
    ptUtil.setUserData(userData)

    navigate(roomId ? `/room/${encodeURIComponent(roomId)}` : "/create", { replace: true })
  }

  return (
    <main className="quiet-page join-page">
      <header className="quiet-topbar" aria-label="页面导航">
        <div className="quiet-brand" aria-label="All Can Listen">
          <span className="quiet-brand-mark" aria-hidden="true">·</span>
          <span>All Can Listen</span>
          <span className="quiet-brand-note">QUIET STUDIO</span>
        </div>
        <button className="quiet-back" type="button" onClick={() => navigate("/")}>
          <span aria-hidden="true">←</span>
          <span>返回首页</span>
        </button>
      </header>

      <div className="join-layout">
        <section className="join-intro" aria-labelledby="join-title">
          <p className="join-eyebrow"><span aria-hidden="true" />进入声场</p>
          <h1 id="join-title">先留下一个<br /><em>彼此好记的称呼。</em></h1>
          <p className="join-description">
            昵称只用于房间内识别。进入以后，你会和朋友看到同一首歌、同一段进度，也能随时在房间里修改称呼。
          </p>

          <div className="join-sound-card" aria-hidden="true">
            <div className="join-sound-meta">
              <span>LIVE ROOM</span>
              <span className="join-live-dot" />
            </div>
            <div className="join-wave">
              <span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span />
            </div>
            <div className="join-track">
              <span>所有人的耳机，正在同一刻播放</span>
              <span>00:42</span>
            </div>
          </div>
        </section>

        <section className="join-panel" aria-labelledby="join-form-title">
          <div className="join-panel-heading">
            <span className="join-step" aria-hidden="true">01</span>
            <div>
              <p>加入前的最后一步</p>
              <h2 id="join-form-title">你希望大家怎么称呼你？</h2>
            </div>
          </div>

          <form className="join-form" onSubmit={submit}>
            <label htmlFor="join-nickname">房间昵称</label>
            <input
              ref={inputRef}
              id="join-nickname"
              value={inputValue}
              placeholder="例如：小宇"
              type="text"
              autoComplete="nickname"
              maxLength={20}
              aria-describedby={showWhitespaceError ? "join-nickname-error join-nickname-hint" : "join-nickname-hint"}
              aria-invalid={showWhitespaceError}
              onBlur={() => setHasBlurred(true)}
              onChange={event => setInputValue(event.target.value)}
            />
            <div className="join-field-meta">
              <span id="join-nickname-hint">最多 20 个字符，仅保存在当前浏览器</span>
              <span aria-label={`已输入 ${inputValue.length} 个字符`}>{inputValue.length}/20</span>
            </div>
            {showWhitespaceError && <p className="join-field-error" id="join-nickname-error">昵称不能只包含空格。</p>}

            <div className="join-actions">
              <PtButton
                className="join-main-btn"
                text={roomId ? "进入房间" : "继续创建房间"}
                onClick={() => submit()}
                disabled={!canSubmit}
              />
              <PtButton text="暂时返回首页" type="other" onClick={() => navigate("/")} />
            </div>
          </form>

          <p className="join-privacy"><span aria-hidden="true">◇</span> 无需注册账号，也不会公开展示个人资料。</p>
        </section>
      </div>
    </main>
  )
}
