/**
 * Logger — 统一的控制台日志工具
 *
 * 提供彩色标签日志、图片日志输出，并监听 window 上的自定义事件
 * 以支持跨上下文（如 background → contentScript）的日志转发。
 */

// 日志级别对应的标签背景色
const LEVEL_COLORS: Record<string, string> = {
  info: '#3eaf45',
  error: '#ff3e45',
  notice: 'orange',
};

// 底层 console.log 绑定，避免被业务代码覆盖
const rawLog = window.console.log.bind(window.console);

// 暴露到全局的快捷日志函数
// window.guanConsoleLog = (...args: unknown[]) => rawLog(...args);

/**
 * 输出带彩色标签的日志
 *
 * 标签格式约定：用 `|` 分隔，第一段为标签名（会被着色），
 * 后续段为日志正文。若消息未含 `|`，默认加上 `GUAN|` 前缀。
 *
 * @example
 *   log('SDK|初始化完成');
 *   log(['SDK', '初始化完成', extraData], 'error');
 */
function log(message: unknown | unknown[], level: string = 'info') {
  const color = LEVEL_COLORS[level] || '#000';

  // 支持单条或多条消息
  const [first, ...rest] = Array.isArray(message) ? message : [message];

  // 解析标签：从首个字符串中提取 `|` 分隔的标签段
  const rawStr = typeof first === 'string' && first.includes('|') ? first : `GUAN|${first}`;
  const [tag, ...bodyParts] = rawStr.split('|');

  // 使用 %c 占位符为标签和正文分别应用样式
  rawLog(
    `%c${tag}%c${bodyParts.join('|')}%c${rest.length ? '\n' : ''}`,
    // 标签样式：彩色背景 + 左圆角
    `background: ${color}; color: white; border-top-left-radius: 5px; border-bottom-left-radius: 5px; margin: 2px 0; padding: 2px 6px 2px 8px; font-family: monospace;`,
    // 正文样式：灰色背景 + 右圆角
    'background: #eee; padding: 2px 6px 2px 8px; color: black; border-top-right-radius: 5px; border-bottom-right-radius: 5px; font-family: monospace;',
    '',
    ...rest,
  );
}

/**
 * 在控制台以图片形式输出日志（利用 CSS background-image hack）
 *
 * 先加载图片确保其可访问，再通过 padding + background-size 让图片居中渲染。
 *
 * @param url 图片地址
 * @param size 输出尺寸，默认 200×200
 */
function logImage(url: string, size: { width: number; height: number } = { width: 200, height: 200 }): Promise<void> {
  const img = new Image();
  const { width, height } = size;

  return new Promise((resolve) => {
    img.onload = () => {
      // 利用字体大小近似为 0，再用 padding撑开显示区
      const paddingStyle = `font-size: 1px; padding: ${Math.floor(height / 2)}px ${Math.floor(width / 2)}px; margin: 0;`;
      rawLog(
        '%c+',
        `${paddingStyle}; background-image: url("${url}"); background-repeat: no-repeat; background-size: ${width}px ${height}px; color: transparent;`,
      );
      resolve();
    };
    img.src = url;
  });
}

// 监听跨上下文的日志事件（如 background 发送到 contentScript）
// 事件 detail 结构：{ message: string, type?: 'info' | 'error' | 'notice' }
window.addEventListener('Guan.Logger', (e: Event) => {
  const detail = (e as CustomEvent).detail || {};
  const { message = '', type = 'info' } = detail;
  log(message, type);
});

export { log, logImage };
