import type { RequestParam, RequestRes } from "../types"
import time from "../utils/time"
import ptUtil from "../utils/pt-util"

let localId = ""

function getCommonParam(): RequestParam {
  if (!localId) localId = ptUtil.getUserData().nonce as string
  return {
    "x-pt-version": PT_ENV.version,
    "x-pt-client": PT_ENV.client,
    "x-pt-stamp": time.getTime(),
    "x-pt-language": navigator.language,
    "x-pt-local-id": localId,
  }
}

export async function request<T = Record<string, any>>(
  url: string,
  body: Record<string, any> = {},
  method = "POST",
): Promise<RequestRes<T>> {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...getCommonParam(), ...body }),
  })

  return await response.json() as RequestRes<T>
}
