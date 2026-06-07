import { useNavigate } from "react-router-dom"
import PtButton from "../../components/PtButton"
import util from "../../utils/util"
import "./contactPage.css"

export default function ContactPage() {
  const navigate = useNavigate()
  const env = util.getEnv()

  return (
    <div className="page">
      <div className="page-container contact-container">
        <h1>联系开发者</h1>
        <div className="contact-card">
          {env.CONTACT_EMAIL && <a href={`mailto:${env.CONTACT_EMAIL}`}>{env.CONTACT_EMAIL}</a>}
          {env.CONTACT_FEISHU && <a href={env.CONTACT_FEISHU} target="_blank" rel="noreferrer">飞书联系</a>}
          {!env.CONTACT_EMAIL && !env.CONTACT_FEISHU && <p>请通过项目主页联系开发者。</p>}
        </div>
        <div className="contact-actions">
          <PtButton text="回首页" type="other" onClick={() => navigate("/")} />
        </div>
      </div>
    </div>
  )
}
