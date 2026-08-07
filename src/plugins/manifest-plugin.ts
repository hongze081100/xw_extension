import type { PluginOption } from 'vite'
import { resolve } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import manifestConfig from '../manifest'

/**
 * 构建完成后，把 src/manifest.ts 的源码路径映射为实际产物路径，
 * 生成最终的 build/manifest.json。
 */
export function manifestPlugin(outDir: string): PluginOption {
  return {
    name: 'crx-manifest',
    apply: 'build',
    writeBundle() {
      const manifest = JSON.parse(JSON.stringify(manifestConfig)) as any

      if (manifest.background?.service_worker) {
        manifest.background.service_worker = 'assets/background.js'
      }

      if (Array.isArray(manifest.content_scripts)) {
        manifest.content_scripts = manifest.content_scripts.map((cs: any) => ({
          ...cs,
          js: Array.isArray(cs.js)
            ? cs.js.map((p: string) => (p.includes('inject') ? 'assets/inject.js' : p))
            : cs.js,
        }))
      }

      if (manifest.action?.default_popup) {
        manifest.action.default_popup = 'popup.html'
      }

      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      console.log('[crx-manifest] manifest.json written')
    },
  }
}
