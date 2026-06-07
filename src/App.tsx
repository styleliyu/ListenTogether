import { RouterProvider } from "react-router-dom"
import { router } from "./router"
import { useTheme } from "./hooks/useTheme"

export default function App() {
  const theme = useTheme()

  return (
    <div className={`classic-theme app-global ${theme === "dark" ? "dark-theme" : ""}`}>
      <RouterProvider router={router} />
    </div>
  )
}
