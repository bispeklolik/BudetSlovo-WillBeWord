import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Второй вход main — MCP-сервер (out/main/mcp.js): его запускает Claude тем же
  // exe «Слова» в режиме Node (ELECTRON_RUN_AS_NODE=1).
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          mcp: resolve(__dirname, 'src/mcp/server.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
