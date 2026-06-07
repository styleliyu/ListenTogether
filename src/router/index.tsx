import { Navigate, createBrowserRouter, redirect } from "react-router-dom"
import ptUtil from "../utils/pt-util"
import IndexPage from "../pages/IndexPage/IndexPage"
import CreatePage from "../pages/CreatePage/CreatePage"
import JoinPage from "../pages/JoinPage/JoinPage"
import RoomPage from "../pages/RoomPage/RoomPage"
import ContactPage from "../pages/ContactPage/ContactPage"

function requireNickName({ params }: { params: Record<string, string | undefined> }) {
  const userData = ptUtil.getUserData()
  if (userData.nickName) return null
  const query = params.roomId ? `?roomId=${encodeURIComponent(params.roomId)}` : ""
  return redirect(`/join${query}`)
}

export const router = createBrowserRouter([
  { path: "/", element: <IndexPage /> },
  { path: "/home", element: <Navigate to="/" replace /> },
  { path: "/create", element: <CreatePage /> },
  { path: "/join", element: <JoinPage /> },
  {
    path: "/room/:roomId",
    loader: requireNickName,
    element: <RoomPage />,
  },
  { path: "/contact", element: <ContactPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
])
