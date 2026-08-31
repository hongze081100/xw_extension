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
  permissions: ['sidePanel', 'storage', 'scripting', 'tabs', 'activeTab'],
  /**
   * MV3 host 权限与 content_scripts.matches 解耦：
   *  - content_scripts.matches = <all_urls> 只决定 content script 注入时机，不授予 host 访问权
   *  - chrome.scripting.executeScript 访问 https://news.baidu.com/ 等非当前用户激活的 tab 时，
   *    必须显式在 host_permissions 声明。否则报：
   *    "Cannot access contents of url ... Extension manifest must request permission to access this host."
   *  - activeTab 只在"用户点击扩展图标/上下文菜单/快捷键之后的那一个 tab"临时生效，
   *    无法覆盖"页面主动发起请求 → background 回复 dispatchEvent"这种异步场景。
   */
  host_permissions: ['<all_urls>'],
}

export default manifest
