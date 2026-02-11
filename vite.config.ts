import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // ← これを追加！ Electronでfile://を正しく解決するため
  server: {
    proxy: {
      '/api': {
        target: 'https://a.4cdn.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/img': {
        target: 'https://i.4cdn.org',
        changeOrigin: true,
        // 🔽 CORS 403 対策：リファラ偽装
        headers: {
          Referer: 'https://boards.4channel.org/',
        },
        rewrite: (path) => path.replace(/^\/img/, ''),
      },
    },
  },
});
