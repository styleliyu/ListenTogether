/// <reference types="vite/client" />

interface PtEnv {
  version: string
  client: string
}

declare const PT_ENV: PtEnv
