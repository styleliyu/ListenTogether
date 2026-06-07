import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from "path"
import { VitePWA } from 'vite-plugin-pwa'
const { version } = require("./package.json")

const projectRoot = __dirname

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: false,
        devOptions: {
          enabled: true,
          type: 'module'
        },
        includeAssets: [
          "apple-touch-icon.png", 
          "favicon-32x32.png", 
          "favicon-16x16.png", 
          "safari-pinned-tab.svg"
        ]
      })
    ],
    server: {
      host: "0.0.0.0"
    },
    resolve: {
      alias: {
        "@": resolve(projectRoot, "src"),
        "@decrypt-core": resolve(projectRoot, "src/decrypt-core"),
      }
    },
    define: {
      "PT_ENV": {
        "version": version,
        "client": "web"
      }
    }
  }
})
