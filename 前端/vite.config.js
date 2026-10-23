import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? './' : '/',
  publicDir: mode === 'pages' ? '../展示版/数据' : 'public',
  resolve: { alias: [{ find: /^\.\/live-source\.js$/, replacement: fileURLToPath(new URL(mode === 'pages' ? './src/static-source.js' : './src/live-source.js', import.meta.url)) }] },
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ['backed-arguments-scroll-cup.trycloudflare.com'],
    proxy: mode === 'pages' ? undefined : {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: mode === 'pages' ? '../展示版/dist' : 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('/zrender/')) return 'chart-renderer'
      if (id.includes('/echarts/')) return 'chart-core'
      if (id.includes('/@vue/') || id.includes('/vue/')) return 'vue'
    } } },
  },
}))
