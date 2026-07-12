import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Веб-версия «Слова»: статическая страница, общий код — src/shared.
// base './' — относительные пути: работает и на GitHub Pages
// (bispeklolik.github.io/BudetSlovo-WillBeWord/), и через CDN-зеркала
// ветки gh-pages (raw.githack / statically), которым не нужны права.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist-web', emptyOutDir: true }
})
