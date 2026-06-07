import React from "react"
import ReactDOM from "react-dom/client"
import "./styles/style.css"
import "./styles/theme.css"
import "shikwasa2/dist/shikwasa.min.css"
import App from "./App"

console.log("### 欢迎使用 Podcast-Together ###")
console.log(`当前版本号: ${PT_ENV.version}`)
console.log(" ")

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
