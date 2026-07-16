import { defineConfig } from 'vite';

// 开发期把 /api 代理到本地 AI 代理服务（默认 5174），
// 这样前端只需请求同源 /api/chat，无需关心跨域或端口。
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
});
