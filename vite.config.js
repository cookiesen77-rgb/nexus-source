import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'electron' || mode === 'tauri'

  return {
    base: isDesktop ? './' : '/nexus',
    plugins: [vue()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            vue: ['vue', 'vue-router'],
            ui: ['naive-ui'],
            flow: ['@vue-flow/core', '@vue-flow/controls', '@vue-flow/minimap', '@vue-flow/background'],
            icons: ['@vicons/ionicons5'],
            vendor: ['axios']
          }
        }
      }
    },
    server: {
      proxy: {
        '/v1': {
          target: 'https://nexusapi.cn',
          changeOrigin: true
        }
      }
    }
  }
})
