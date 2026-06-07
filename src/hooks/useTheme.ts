import { useEffect, useState } from "react"

export type ThemeType = "light" | "dark"

const media = window.matchMedia("(prefers-color-scheme: dark)")

export function useTheme(): ThemeType {
  const [theme, setTheme] = useState<ThemeType>(media.matches ? "dark" : "light")

  useEffect(() => {
    const onChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? "dark" : "light")
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return theme
}
