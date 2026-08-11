import { RefObject, useEffect } from "react"

interface PlayerPanelProps {
  playerRef: RefObject<HTMLDivElement>
}

export default function PlayerPanel({ playerRef }: PlayerPanelProps) {
  useEffect(() => {
    const playerRoot = playerRef.current
    if (!playerRoot) return

    const normalizeProgressSemantics = () => {
      playerRoot.querySelectorAll<HTMLElement>(".shk-bar_played").forEach(progress => {
        progress.removeAttribute("role")
        progress.removeAttribute("aria-label")
        progress.removeAttribute("aria-valuenow")
        progress.removeAttribute("aria-valuemin")
        progress.removeAttribute("aria-valuemax")
      })
    }

    normalizeProgressSemantics()
    const observer = new MutationObserver(normalizeProgressSemantics)
    observer.observe(playerRoot, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [playerRef])

  return (
    <section className="room-player-card" aria-labelledby="room-player-title">
      <div className="room-player-intro">
        <div>
          <span className="room-player-kicker">NOW PLAYING</span>
          <h2 id="room-player-title">当前播放声场</h2>
        </div>
        <div className="room-player-signal" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <div ref={playerRef} className="rp-player" />
    </section>
  )
}
