import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

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
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) }
  }
})
