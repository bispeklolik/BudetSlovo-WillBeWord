import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Веб-версия «Слова»: статическая страница (GitHub Pages), общий код — src/shared.
export default defineConfig({
  root: 'web',
  base: '/BudetSlovo-WillBeWord/',
  plugins: [react()],
  build: { outDir: '../dist-web', emptyOutDir: true }
})
