import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Host the dev API proxy forwards `/api/*` to (set in `.env.development`).
  const devApiTarget =
    env.VITE_DEV_API_TARGET || 'https://api.pharma-connect.in'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Explicitly configure headers to allow cross-origin popup tracking
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
      /**
       * Proxy every `/api/*` request to the dev backend so the browser only ever
       * talks to `http://localhost:5173`.
       *
       * The session is an httpOnly cookie set by the API. Browsers only send a
       * cookie on a *cross-site* request (localhost -> dev.api.pharma-connect.in)
       * when it is explicitly `SameSite=None; Secure`, so a `SameSite=Lax`
       * session cookie is silently dropped and every authenticated call fails
       * with `401 Unauthorized: No session cookie provided`. Proxying keeps the
       * request first-party, so the cookie is stored and replayed locally with
       * no backend change.
       *
       * `cookieDomainRewrite: ''` strips the `Domain=...` attribute from
       * `Set-Cookie`; without it the browser refuses to store the cookie for
       * `localhost` and the same 401 comes back.
       */
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
          secure: true,
          cookieDomainRewrite: '',
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
