/// <reference types="vitest" />
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** 开发时让 /admin 与生产环境一样打开控制后台（生产由服务端托管 admin.html）。 */
function adminRoute(): Plugin {
  return {
    name: 'token-town-admin-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/admin\/?(\?|#|$)/.test(req.url)) req.url = req.url.replace(/^\/admin\/?/, '/admin.html')
        next()
      })
    },
  }
}

// VITE_BASE_PATH 用于部署到子路径（例如 /token-town/）；默认根路径。
// 开发时 Vite 在 3200 端口提供页面，/api 代理到 3201 端口的服务端（pnpm dev 会同时启动两者）。
export default defineConfig(({ isSsrBuild }) => ({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), adminRoute()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 3200,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3201}` },
  },
  preview: { port: 3200 },
  build: isSsrBuild
    ? {
        // 服务端：vite build --ssr server/index.ts --outDir dist-server，依赖保持外部引用
        copyPublicDir: false,
        target: 'node22',
      }
    : {
        chunkSizeWarningLimit: 800,
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            admin: path.resolve(__dirname, 'admin.html'),
          },
          output: {
            manualChunks: { three: ['three'] },
          },
        },
      },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
}))
