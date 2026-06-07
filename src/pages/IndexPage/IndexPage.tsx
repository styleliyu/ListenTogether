import { useState } from "react"
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

const usageTutorial = `1. 点击“创建房间”。
2. 粘贴网易云、QQ、酷狗、酷我、百度/千千音乐的单曲或歌单链接，或点击“导入本地歌曲”选择本地文件。
3. 本地文件支持 mp3、m4a、aac、flac、wav、ogg，以及 ncm、qmc、kgm、kwm 等常见加密音乐格式。
4. 创建成功后，把房间链接发给朋友；同一房间内会同步播放、暂停、进度拖动、上一首、下一首和播放模式。
5. 房间内可以继续添加单曲或歌单。导入大歌单时可在进度面板查看已解析、已加入和失败数量，也可以取消导入。`

export default function IndexPage() {
  const navigate = useNavigate()
  const [showGithubMenu, setShowGithubMenu] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)

  return (
    <>
      <div className="page index-page">
        <div className="index-actions">
          <button className="index-action-text" type="button" onClick={() => setShowTutorial(true)}>教程</button>
          <button
            className="index-action-icon"
            type="button"
            aria-label="GitHub 项目"
            title="GitHub 项目"
            onClick={() => {
              setShowGithubMenu(value => !value)
              setShowTutorial(false)
            }}
          >
            <img src={images.GITHUB} className="index-github-icon" />
          </button>

          {showGithubMenu && (
            <div className="index-dropdown index-github-menu">
              {githubLinks.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.name}</a>)}
            </div>
          )}
        </div>

        <div className="page-container index-container">
          <h1>一起听</h1>
          <p>和朋友实时同步听音乐、播客和本地音频。</p>
          <div className="index-btns">
            <PtButton text="创建房间" onClick={() => navigate("/create")} />
            <PtButton text="查看教程" type="other" onClick={() => setShowTutorial(true)} />
          </div>
        </div>
      </div>

      {showTutorial && (
        <div className="index-doc-modal">
          <div className="index-doc-bg" onClick={() => setShowTutorial(false)} />
          <article className="index-doc-panel">
            <header>
              <h2>使用教程</h2>
              <button type="button" onClick={() => setShowTutorial(false)}>关闭</button>
            </header>
            <pre>{usageTutorial}</pre>
          </article>
        </div>
      )}
    </>
  )
}
