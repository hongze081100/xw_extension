import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
// import makeManifestPlugin from './utils/plugins/make-manifest-plugin';
// import { watchRebuildPlugin } from '@chrome-extension-boilerplate/hmr';
// import viteObfuscateFile from 'vite-plugin-javascript-obfuscator';

import manifest from './src/manifest';

const rootDir = resolve(__dirname);
const srcDir = resolve(__dirname, 'src');

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    resolve: {
      alias: {
        '@': srcDir,
      },
    },
    publicDir: resolve(rootDir, 'public'),
    build: {
      emptyOutDir: true,
      outDir: 'build',
      // minify: false,
      // reportCompressedSize: true, // 默认为 true
      // modulePreload: true,
      // sourcemap: true
      rollupOptions: {
        // external: ['chrome'],
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler', // 使用 modern API，消除旧版 API 弃用警告
        },
      },
    },
    plugins: [
      crx({ manifest }), 
      react()
    ],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
    optimizeDeps: {
      force: true, // 强制重新预构建依赖
    },
  }
})

