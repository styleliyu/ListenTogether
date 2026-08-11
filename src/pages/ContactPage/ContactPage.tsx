import { useNavigate } from "react-router-dom"
import PtButton from "../../components/PtButton"
import util from "../../utils/util"
import "./contactPage.css"

export default function ContactPage() {
  const navigate = useNavigate()
  const env = util.getEnv()
  const hasContactMethod = Boolean(env.CONTACT_EMAIL || env.CONTACT_FEISHU)

  return (
    <main className="quiet-page contact-page">
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

      <div className="contact-layout">
        <section className="contact-intro" aria-labelledby="contact-title">
          <p className="contact-eyebrow"><span aria-hidden="true" />保持联系</p>
          <h1 id="contact-title">有想法，<br /><em>就让它被听见。</em></h1>
          <p className="contact-description">
            无论是使用问题、功能建议，还是想一起完善这个项目，都欢迎告诉我们。描述越具体，越容易快速理解你的现场。
          </p>

          <ul className="contact-tips" aria-label="联系时建议附带的信息">
            <li><span aria-hidden="true">01</span>你正在进行的操作</li>
            <li><span aria-hidden="true">02</span>遇到的现象或期待结果</li>
            <li><span aria-hidden="true">03</span>可复现步骤与设备环境</li>
          </ul>
        </section>

        <section className="contact-panel" aria-labelledby="contact-method-title">
          <div className="contact-panel-heading">
            <div>
              <p>CONTACT</p>
              <h2 id="contact-method-title">{hasContactMethod ? "选择一种联系方式" : "联系与反馈"}</h2>
            </div>
            <span
              className={`contact-status ${hasContactMethod ? "" : "contact-status_unavailable"}`}
              aria-label={hasContactMethod ? "联系渠道可用" : "联系渠道暂未配置"}
            >
              <span aria-hidden="true" /> {hasContactMethod ? "OPEN" : "INFO"}
            </span>
          </div>

          <div className="contact-methods">
            {env.CONTACT_EMAIL && (
              <a className="contact-method" href={`mailto:${env.CONTACT_EMAIL}`}>
                <span className="contact-method-mark" aria-hidden="true">@</span>
                <span className="contact-method-copy">
                  <span>电子邮件</span>
                  <strong>{env.CONTACT_EMAIL}</strong>
                </span>
                <span className="contact-method-arrow" aria-hidden="true">↗</span>
              </a>
            )}
            {env.CONTACT_FEISHU && (
              <a className="contact-method" href={env.CONTACT_FEISHU} target="_blank" rel="noreferrer">
                <span className="contact-method-mark" aria-hidden="true">◇</span>
                <span className="contact-method-copy">
                  <span>飞书</span>
                  <strong>打开联系页面</strong>
                </span>
                <span className="contact-method-arrow" aria-hidden="true">↗</span>
              </a>
            )}
            {!hasContactMethod && (
              <div className="contact-empty" role="status">
                <span aria-hidden="true">·</span>
                <div>
                  <strong>暂未配置直接联系渠道</strong>
                  <p>请先返回项目首页，通过项目主页与开发者取得联系。</p>
                </div>
              </div>
            )}
          </div>

          <div className="contact-actions">
            <PtButton text="返回首页" type={hasContactMethod ? "other" : "main"} onClick={() => navigate("/")} />
          </div>
          <p className="contact-note"><span aria-hidden="true">◇</span> 请勿在消息中发送密码、密钥或其他敏感信息。</p>
        </section>
      </div>
    </main>
  )
}
