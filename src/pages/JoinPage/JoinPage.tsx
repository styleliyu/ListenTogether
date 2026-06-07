import { FormEvent, useMemo, useRef, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import PtButton from "../../components/PtButton"
import ptUtil from "../../utils/pt-util"
import "./joinPage.css"

export default function JoinPage() {
  const [inputValue, setInputValue] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const canSubmit = useMemo(() => inputValue.trim().length > 0, [inputValue])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit) return
    const userData = ptUtil.getUserData()
    userData.nickName = inputValue.trim().slice(0, 20)
    ptUtil.setUserData(userData)

    const params = new URLSearchParams(location.search)
    const roomId = params.get("roomId")
    navigate(roomId ? `/room/${encodeURIComponent(roomId)}` : "/create", { replace: true })
  }

  return (
    <>
      <form className="page" onSubmit={submit}>
        <div className="page-container join-container">
          <h1>你的昵称</h1>
          <input
            ref={inputRef}
            value={inputValue}
            placeholder="请输入你的昵称"
            type="text"
            maxLength={20}
            onChange={event => setInputValue(event.target.value)}
          />
          <div className="page-btns-virtual" />
        </div>
      </form>
      <div className="page-btns-container">
        <div className="page-btns">
          <PtButton className="join-main-btn" text="确定" onClick={() => submit()} disabled={!canSubmit} />
          <PtButton text="回首页" type="other" onClick={() => navigate("/")} />
        </div>
      </div>
    </>
  )
}
