import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { manifestPlugin } from './src/plugins/manifest-plugin'

const rootDir = resolve(__dirname)
const srcDir = resolve(rootDir, 'src')
const outDir = resolve(rootDir, 'build')

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  publicDir: resolve(rootDir, 'public'),
  base: './',
  build: {
    emptyOutDir: true,
    outDir,
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        background: resolve(srcDir, 'background/index.ts'),
        inject: resolve(srcDir, 'inject/index.tsx'),
        content: resolve(srcDir, 'pages/content.tsx'),
        injectData: resolve(srcDir, 'pages/injectData.tsx'),
        popup: resolve(rootDir, 'popup.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || ''
          if (name.endsWith('.css')) return 'assets/[name][extname]'
          return 'assets/[name]-[hash][extname]'
        },
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('antd') || id.includes('@ant-design') || id.includes('dayjs')) {
              return 'vendor-antd'
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'vendor-react'
            }
          }
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  plugins: [react(), manifestPlugin(outDir)],
  legacy: {
    skipWebSocketTokenCheck: true,
  },
  optimizeDeps: {
    force: true,
  },
})
