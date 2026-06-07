interface PtButtonProps {
  text: string
  type?: "main" | "other"
  disabled?: boolean
  className?: string
  onClick?: () => void
}

export default function PtButton({
  text,
  type = "main",
  disabled = false,
  className = "",
  onClick,
}: PtButtonProps) {
  return (
    <button
      className={`pt-button pt-button_${type} ${className}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {text}
    </button>
  )
}
