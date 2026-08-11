import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import images from "../../images"
import PtButton from "../../components/PtButton"
import "./indexPage.css"

const githubLinks = [
  { name: "我的 GitHub", url: "https://github.com/styleliyu" },
  { name: "yenche123/podcast-together", url: "https://github.com/yenche123/podcast-together" },
  { name: "metowolf/Meting", url: "https://github.com/metowolf/Meting" },
  { name: "copws/qq-music-api", url: "https://github.com/copws/qq-music-api" },
  { name: "listen1/listen1_desktop", url: "https://github.com/listen1/listen1_desktop" },
]

const usageTutorial = [
  "点击“创建房间”。",
  "粘贴网易云、QQ、酷狗、酷我、百度/千千音乐的单曲或歌单链接，或点击“导入本地歌曲”选择本地文件。",
  "本地文件支持 mp3、m4a、aac、flac、wav、ogg，以及 ncm、qmc、kgm、kwm 等常见加密音乐格式。",
  "创建成功后，把房间链接发给朋友；同一房间内会同步播放、暂停、进度拖动、上一首、下一首和播放模式。",
  "房间内可以继续添加单曲或歌单。导入大歌单时可在进度面板查看已解析、已加入和失败数量，也可以取消导入。",
]

const githubMenuId = "index-github-menu"
const tutorialTitleId = "index-tutorial-title"

export default function IndexPage() {
  const navigate = useNavigate()
  const [showGithubMenu, setShowGithubMenu] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const githubTriggerRef = useRef<HTMLButtonElement>(null)
  const githubMenuRef = useRef<HTMLDivElement>(null)
  const tutorialTriggerRef = useRef<HTMLButtonElement>(null)
  const tutorialCloseRef = useRef<HTMLButtonElement>(null)
  const tutorialPanelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!showGithubMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!githubMenuRef.current?.contains(target) && !githubTriggerRef.current?.contains(target)) {
        setShowGithubMenu(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setShowGithubMenu(false)
        githubTriggerRef.current?.focus()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    const firstLink = githubMenuRef.current?.querySelector<HTMLAnchorElement>("a")
    firstLink?.focus()

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [showGithubMenu])

  useEffect(() => {
    if (!showTutorial) return

    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    tutorialCloseRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeTutorial()
        return
      }

      if (event.key !== "Tab" || !tutorialPanelRef.current) return
      const focusable = Array.from(
        tutorialPanelRef.current.querySelectorAll<HTMLElement>(
          "button, a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
    }
  }, [showTutorial])

  const closeTutorial = () => {
    setShowTutorial(false)
    window.setTimeout(() => tutorialTriggerRef.current?.focus(), 0)
  }

  const openTutorial = () => {
    setShowGithubMenu(false)
    setShowTutorial(true)
  }

  const handleGithubMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const links = Array.from(githubMenuRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])
    if (!links.length) return

    const activeIndex = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      links[(activeIndex + direction + links.length) % links.length].focus()
    } else if (event.key === "Home") {
      event.preventDefault()
      links[0].focus()
    } else if (event.key === "End") {
      event.preventDefault()
      links[links.length - 1].focus()
    }
  }

  return (
    <div className="page index-page">
      <header className="index-topbar">
        <div className="index-brand" aria-label="一起听首页">
          <span className="index-brand-mark" aria-hidden="true">◌</span>
          <span>一起听</span>
          <span className="index-brand-kicker">QUIET STUDIO</span>
        </div>

        <nav className="index-actions" aria-label="辅助导航">
          <button
            ref={tutorialTriggerRef}
            className="index-action-text"
            type="button"
            onClick={openTutorial}
          >
            教程
          </button>
          <div className="index-github-anchor">
            <button
              ref={githubTriggerRef}
              className="index-action-icon"
              type="button"
              aria-label="GitHub 项目"
              title="GitHub 项目"
              aria-expanded={showGithubMenu}
              aria-controls={githubMenuId}
              onClick={() => {
                setShowGithubMenu(value => !value)
                setShowTutorial(false)
              }}
            >
              <img src={images.GITHUB} className="index-github-icon index-github-icon--light" alt="" aria-hidden="true" />
              <img src={images.GITHUB_DM} className="index-github-icon index-github-icon--dark" alt="" aria-hidden="true" />
            </button>

            {showGithubMenu && (
              <div
                ref={githubMenuRef}
                id={githubMenuId}
                className="index-dropdown index-github-menu"
                role="menu"
                aria-label="GitHub 项目链接"
                onKeyDown={handleGithubMenuKeyDown}
              >
                {githubLinks.map(link => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer" role="menuitem">
                    <span>{link.name}</span>
                    <span className="index-menu-arrow" aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </nav>
      </header>

      <main className="page-container index-container">
        <section className="index-hero" aria-labelledby="index-title">
          <div className="index-hero-copy">
            <p className="index-eyebrow"><span aria-hidden="true" />一起听 · 实时同步聆听</p>
            <h1 id="index-title">
              音乐、播客，<br />
              <span>和朋友听在</span><br />
              <em>同一个进度里。</em>
            </h1>
            <p className="index-description">和朋友实时同步听音乐、播客和本地音频。创建一个房间，把此刻分享出去。</p>
            <div className="index-hero-actions">
              <PtButton
                text="创建房间"
                className="index-primary-action"
                onClick={() => navigate("/create")}
              />
              <p className="index-action-note"><span aria-hidden="true">⌁</span> 不需要注册，创建后即可分享房间链接</p>
            </div>
          </div>

          <div className="index-visual" aria-hidden="true">
            <div className="index-visual-label">
              <span>SYNCED SOUNDSCAPE</span>
              <span className="index-visual-live"><i /> LIVE TOGETHER</span>
            </div>
            <div className="index-visual-stage">
              <div className="index-wave index-wave--back"><span /><span /><span /><span /><span /></div>
              <div className="index-wave index-wave--front"><span /><span /><span /><span /><span /></div>
              <div className="index-orbit index-orbit--one"><i /></div>
              <div className="index-orbit index-orbit--two"><i /></div>
              <div className="index-orbit index-orbit--three"><i /></div>
              <div className="index-center-mark">◌</div>
            </div>
            <div className="index-visual-caption">
              <span className="index-caption-line" />
              <p>每个人都在同一刻听见</p>
              <span>01 / 03</span>
            </div>
          </div>
        </section>

        <section className="index-capabilities" aria-label="一起听的主要能力">
          <article className="index-capability">
            <span className="index-capability-number">01</span>
            <div>
              <h2>粘贴链接</h2>
              <p>单曲、歌单或播客，一次添加。</p>
            </div>
          </article>
          <article className="index-capability">
            <span className="index-capability-number">02</span>
            <div>
              <h2>导入本地</h2>
              <p>普通及加密音乐，都能一起听。</p>
            </div>
          </article>
          <article className="index-capability">
            <span className="index-capability-number">03</span>
            <div>
              <h2>分享后同步</h2>
              <p>把房间链接发给朋友，进度始终一致。</p>
            </div>
          </article>
        </section>

        <p className="index-footer-note">把声音留在一起，也把距离放轻一点。</p>
      </main>

      {showTutorial && (
        <div className="index-doc-modal" role="presentation">
          <div className="index-doc-bg" aria-hidden="true" onPointerDown={closeTutorial} />
          <article
            ref={tutorialPanelRef}
            className="index-doc-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={tutorialTitleId}
          >
            <header>
              <div>
                <p className="index-dialog-kicker">GET STARTED</p>
                <h2 id={tutorialTitleId}>使用教程</h2>
              </div>
              <button className="index-dialog-close" type="button" onClick={closeTutorial} ref={tutorialCloseRef}>
                关闭<span aria-hidden="true">×</span>
              </button>
            </header>
            <ol>
              {usageTutorial.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
          </article>
        </div>
      )}
    </div>
  )
}
