import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_URL || 'http://129.121.135.236:8080'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Explicitly configure headers to allow cross-origin popup tracking
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
      // Proxy API calls in dev so the backend's cookies are treated as
      // same-site instead of being rejected in a cross-site context.
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})  
