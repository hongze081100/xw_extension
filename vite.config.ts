import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'path'
import manifest from './src/manifest'

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
        // content.tsx / injectData.tsx 不属于 manifest 声明的入口：
        //  - content.tsx：由 inject/index.tsx 通过 <script type="module"> + chrome.runtime.getURL
        //    注入到页面 MAIN world，输出必须精确命名为 assets/content.js 以匹配代码引用
        //  - injectData.tsx：作为可扩展的动态注入脚本入口保留
        content: resolve(srcDir, 'pages/content.tsx'),
        injectData: resolve(srcDir, 'pages/injectData.tsx'),
      },
      output: {
        /**
         * 遵循 project memory 的 chunk 分层约定：
         *  - content/inject/injectData 等由 crxjs 处理为独立单文件，不产出共享 chunk。
         *  - popup/background 正常按 vendor 前缀分块（运行在支持 ES module 的环境）
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // 循环 chunk：react ↔ antd 共享依赖，不细分子前缀，统一一个 vendor 更稳
          return 'vendor'
        },
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || ''
          if (name.endsWith('.css')) return 'assets/[name][extname]'
          return 'assets/[name]-[hash][extname]'
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
  plugins: [
    react(),
    // @crxjs/vite-plugin：自动解析 manifest 中的源码路径，负责 Chrome 扩展专属打包逻辑：
    //   - content_scripts / MAIN world 脚本自动内联所有依赖（不产生顶层 import/export）
    //   - background.service_worker 按 type: 'module' 正常支持 ESM
    //   - popup HTML 正常作为 HTML 入口打包
    //   - 构建后产物路径自动回填到 manifest.json
    crx({ manifest: manifest as any }) as PluginOption,
  ],
  legacy: {
    skipWebSocketTokenCheck: true,
  },
  optimizeDeps: {
    force: true,
  },
})
