import { RefObject } from "react"

interface PlayerPanelProps {
  playerRef: RefObject<HTMLDivElement>
}

export default function PlayerPanel({ playerRef }: PlayerPanelProps) {
  return <div ref={playerRef} className="rp-player" />
}
