   import process from 'node:process'
   import { defineConfig } from 'vite'
    import react from '@vitejs/plugin-react'
    import tailwindcss from '@tailwindcss/vite'

    const analysisHelperPort = process.env.ANALYSIS_HELPER_PORT || '4310'
    const analysisHelperTarget = `http://127.0.0.1:${analysisHelperPort}`

    export default defineConfig({
      plugins: [
        react(),
        tailwindcss(),
      ],
      server: {
        proxy: {
          '/api': analysisHelperTarget,
        },
      },
      preview: {
        proxy: {
          '/api': analysisHelperTarget,
        },
      },
    })
