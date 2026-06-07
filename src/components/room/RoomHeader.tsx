interface RoomHeaderProps {
  title: string
}

export default function RoomHeader({ title }: RoomHeaderProps) {
  return (
    <div className="room-header">
      <h1>{title}</h1>
    </div>
  )
}
