import packageData from '../package.json'

const isDev = process.env.NODE_ENV === 'development'

/**
 * Chrome Extension Manifest V3 配置
 *
 * 注意：这里的路径是源码路径，manifestPlugin 会在构建时映射为实际产物路径
 */
const manifest = {
  name: `${packageData.displayName || packageData.name}${isDev ? ' ➡️ Dev' : ''}`,
  description: packageData.description,
  version: packageData.version,
  manifest_version: 3 as const,
  icons: {
    16: 'img/logo-16.png',
    32: 'img/logo-32.png',
    48: 'img/logo-48.png',
    128: 'img/logo-128.png',
  },
  action: {
    default_popup: 'popup.html',
    default_icon: 'img/logo-48.png',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module' as const,
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/inject/index.tsx'],
      run_at: 'document_start' as const,
    },
  ],
  web_accessible_resources: [
    {
      "matches": [ "<all_urls>" ],
      "resources": [ "*.js", "*.css" ]
    },
  ],
  permissions: ['sidePanel', 'storage', 'scripting'],
}

export default manifest
