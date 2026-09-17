/**
 * Script / Link DOM 拦截代理子系统
 *
 * 从 content_kd.js Module 987（lines ~1498-1626）提取的 DOM 劫持模块。
 * 通过 monkey-patch HTMLHeadElement / HTMLBodyElement / HTMLDivElement /
 * HTMLScriptElement 原型上的 appendChild 与 insertBefore，
 * 实现对动态注入 <script> / <link> 元素的拦截、修改与 HTTPS 代理转发。
 *
 * 提供：
 * - Script / Link / 通用元素 三级钩子注册机制
 * - 原型方法劫持（toString / valueOf 伪装为 native code，避免被检测）
 * - IP URL → reviewcook 域名替换（HTTP 调试场景混合内容绕过）
 * - HTTPS 页面代理 HTTP 脚本请求（通过扩展后台 fetch 转发）
 */

import { dispatchPageAction } from "./page-action-bridge";
import { REVIEWCOOK_HOST } from "./constants";

/* ============================================================
 * 模块级钩子存储
 * ============================================================ */

/** <script> 元素拦截钩子列表 */
const _scriptHooks: ScriptHook[] = [];

/** <link> 元素拦截钩子列表 */
const _linkHooks: LinkHook[] = [];

/** 通用元素拦截钩子列表（对非 script/link 生效） */
const _genericHooks: GenericHook[] = [];

/* ============================================================
 * 类型定义
 * ============================================================ */

/**
 * Script 拦截钩子类型
 *
 * 当页面通过 appendChild / insertBefore 动态注入带 src 的
 * <script> 元素时，已注册的钩子依次被调用。
 *
 * @param element - 待注入的 <script> 元素
 * @param appendOriginal - 调用此函数执行原始 DOM 插入操作
 * @returns 替换后的元素（传递给下一个钩子继续处理），或 null 阻止注入
 */
export type ScriptHook = (
  element: HTMLScriptElement,
  appendOriginal: (el: HTMLScriptElement) => Element | null,
) => HTMLScriptElement | null;

/**
 * Link 拦截钩子类型
 *
 * 对带 href 的 <link> 元素生效。
 *
 * @param element - 待注入的 <link> 元素
 * @param appendOriginal - 调用此函数执行原始 DOM 插入操作
 * @returns 替换后的元素（传递给下一个钩子继续处理），或 null 阻止注入
 */
export type LinkHook = (
  element: HTMLLinkElement,
  appendOriginal: (el: HTMLLinkElement) => Element | null,
) => HTMLLinkElement | null;

/**
 * 通用元素拦截钩子类型
 *
 * 对非 <script> / <link> 的 appendChild 调用生效。
 * 钩子执行完毕后，始终会调用原始 appendChild（无法阻止）。
 *
 * @param element - 待注入的任意元素
 * @param appendOriginal - 调用此函数执行原始 DOM 插入操作
 */
export type GenericHook = (
  element: Element,
  appendOriginal: (el: Element) => Element,
) => void;

/* ============================================================
 * 钩子注册 API
 * ============================================================ */

/**
 * 注册 <script> 拦截钩子
 *
 * 当页面通过 appendChild / insertBefore 动态注入带 src 的
 * <script> 元素时，已注册的钩子依次被调用。若任一钩子返回
 * null，则脚本被阻止注入（替换为一个空的 script 元素）。
 * 若钩子返回新元素，则该元素传递给下一个钩子继续处理。
 *
 * 注意：不带 src 的内联 script 不会触发 script 钩子。
 *
 * @param hook - 脚本拦截钩子
 */
export function addScriptHook(hook: ScriptHook): void {
  if (!_scriptHooks.includes(hook)) {
    _scriptHooks.push(hook);
  }
}

/**
 * 注册 <link> 拦截钩子
 *
 * 对带 href 属性的 <link> 元素生效。行为与 script 钩子一致：
 * 返回 null 阻止注入，返回新元素传递给下一个钩子。
 *
 * @param hook - 样式表拦截钩子
 */
export function addLinkHook(hook: LinkHook): void {
  if (!_linkHooks.includes(hook)) {
    _linkHooks.push(hook);
  }
}

/**
 * 注册通用元素拦截钩子
 *
 * 对非 <script> / <link> 的 appendChild 调用生效。
 * 钩子执行完毕后始终会调用原始 appendChild，无法通过
 * 返回值阻止元素注入。
 *
 * @param hook - 通用元素拦截钩子
 */
export function addGenericHook(hook: GenericHook): void {
  if (!_genericHooks.includes(hook)) {
    _genericHooks.push(hook);
  }
}

/* ============================================================
 * DOM 劫持核心
 * ============================================================ */

/**
 * 劫持指定原型上的 appendChild 和 insertBefore
 *
 * 所有被劫持的方法会覆盖 toString / valueOf 为
 * "[native code]" 外观，避免被页面脚本检测。
 *
 * @param proto - 需要劫持的原型对象
 */
function _installProxy(proto: Node): void {
  const anyProto = proto as unknown as {
    appendChild: (child: Node) => Node;
    insertBefore: (child: Node, refNode: Node | null) => Node;
  };

  const originalAppend = anyProto.appendChild.bind(proto);
  const originalInsert = anyProto.insertBefore.bind(proto);

  /* ---- appendChild 劫持 ---- */
  anyProto.appendChild = function (child: Node): Node {
    const self = this as unknown as Node;

    if (child instanceof HTMLScriptElement) {
      let result: HTMLScriptElement | null = child;
      for (const hook of _scriptHooks) {
        if (result) {
          const hasSrc = result.src || result.getAttribute("src");
          if (hasSrc) {
            const appendFn = ((el: HTMLScriptElement) =>
              originalAppend.call(self, el) as Element | null) as (
              el: HTMLScriptElement,
            ) => Element | null;
            result = hook(result, appendFn) as HTMLScriptElement | null;
          }
        }
      }
      if (result) {
        return originalAppend.call(self, result);
      }
      const blocked = document.createElement("script");
      return originalAppend.call(self, blocked);
    }

    if (child instanceof HTMLLinkElement) {
      let result: HTMLLinkElement | null = child;
      for (const hook of _linkHooks) {
        if (result && result.href) {
          const appendFn = ((el: HTMLLinkElement) =>
            originalAppend.call(self, el) as Element | null) as (
            el: HTMLLinkElement,
          ) => Element | null;
          result = hook(result, appendFn) as HTMLLinkElement | null;
        }
      }
      if (result) {
        return originalAppend.call(self, result);
      }
      const blocked = document.createElement("link");
      return originalAppend.call(self, blocked);
    }

    for (const hook of _genericHooks) {
      const appendFn = ((el: Element) =>
        originalAppend.call(self, el)) as (el: Element) => Element;
      hook(child as Element, appendFn);
    }
    return originalAppend.call(self, child);
  };

  _nativeify(anyProto.appendChild, "appendChild");

  /* ---- insertBefore 劫持 ---- */
  anyProto.insertBefore = function (child: Node, refNode: Node | null): Node {
    const self = this as unknown as Node;

    if (child instanceof HTMLScriptElement) {
      let result: HTMLScriptElement | null = child;
      for (const hook of _scriptHooks) {
        if (result && result.src) {
          const insertFn = ((node: HTMLScriptElement) =>
            originalInsert.call(self, node, refNode) as Element | null) as (
            el: HTMLScriptElement,
          ) => Element | null;
          result = hook(result, insertFn) as HTMLScriptElement | null;
        }
      }
      if (result) {
        return originalInsert.call(self, result, refNode);
      }
      const blocked = document.createElement("script");
      return originalInsert.call(self, blocked, refNode);
    }

    if (child instanceof HTMLLinkElement) {
      let result: HTMLLinkElement | null = child;
      for (const hook of _linkHooks) {
        if (result && result.href) {
          const insertFn = ((node: HTMLLinkElement) =>
            originalInsert.call(self, node, refNode) as Element | null) as (
            el: HTMLLinkElement,
          ) => Element | null;
          result = hook(result, insertFn) as HTMLLinkElement | null;
        }
      }
      if (result) {
        return originalInsert.call(self, result, refNode);
      }
      const blocked = document.createElement("link");
      return originalInsert.call(self, blocked, refNode);
    }

    return originalInsert.call(self, child, refNode);
  };

  _nativeify(anyProto.insertBefore, "insertBefore");
}

/**
 * 将被劫持的方法伪装为原生方法
 *
 * 覆盖 toString / valueOf，使 Function.prototype.toString
 * 返回 "[native code]" 外观字符串，避免被页面脚本通过
 * .toString() 检测方法是否被 monkey-patch。
 *
 * @param fn - 需要伪装的函数
 * @param name - 函数名称
 */
function _nativeify(fn: Function, name: string): void {
  fn.toString = () => `${name}() { [native code] }`;
  fn.valueOf = () => `${name}() { [native code] }`;
}

/**
 * 启动 Script / Link 代理
 *
 * monkey-patch 以下原型上的 appendChild 与 insertBefore：
 * - HTMLHeadElement.prototype
 * - HTMLDivElement.prototype
 * - HTMLBodyElement.prototype
 * - HTMLScriptElement.prototype
 *
 * 模块加载时自动调用一次，无需手动触发。
 */
export function setupScriptProxy(): void {
  const prototypes: Node[] = [
    HTMLHeadElement.prototype,
    HTMLDivElement.prototype,
    HTMLBodyElement.prototype,
    HTMLScriptElement.prototype,
  ];
  for (const proto of prototypes) {
    _installProxy(proto);
  }
}

setupScriptProxy();

/* ============================================================
 * DOM 创建辅助
 * ============================================================ */

/**
 * 创建 <script> 标签
 *
 * @param src - 可选，设置脚本的 src URL
 * @param type - 可选，设置 type 属性值（如 "text/javascript"、"module" 等）
 * @returns 新建的 HTMLScriptElement
 */
export function createScriptTag(
  src?: string,
  type?: string,
): HTMLScriptElement {
  const script = document.createElement("script");
  if (src !== undefined) {
    script.src = src;
  }
  if (type !== undefined) {
    script.setAttribute("type", type);
  }
  return script;
}

/**
 * 创建 <link> 标签（stylesheet）
 *
 * 创建后自动设置 rel="stylesheet" 和 href 属性。
 *
 * @param href - 样式表 URL
 * @returns 新建的 HTMLLinkElement
 */
export function createLinkTag(href: string): HTMLLinkElement {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  return link;
}

/* ============================================================
 * URL 处理
 * ============================================================ */

/**
 * IP 地址 URL 转换为 reviewcook 代理域名
 *
 * 在 HTTPS 页面上加载 HTTP IP 地址资源会触发浏览器混合内容
 * 拦截（Mixed Content）。此函数将形如
 * `http://30.x.x.x:port/path` 的 URL 重写为
 * `https://30-x-x-x-port.reviewcook.taobao.com/path`，
 * 通过 reviewcook 服务进行 HTTPS 代理转发。
 *
 * 仅处理 IP 首段为 30（阿里内网段）且协议为 http 的 URL；
 * 其他 URL 原样返回。
 *
 * @param url - 原始 URL
 * @returns 转换后的 URL；不匹配或解析失败时原样返回
 */
export function ipToReviewcook(url: string): string {
  try {
    const parsed = new URL(url);
    const match = parsed.host.match(/^(\d+)\.(\d+\.)+\d+(\:\d+)?$/);
    if (
      match &&
      parseInt(match[1], 10) === 30 &&
      parsed.protocol === "http:"
    ) {
      const { href, origin } = parsed;
      return href.replace(
        origin,
        `https://${match[0].replace(/[:.]/g, "-")}.${REVIEWCOOK_HOST}`,
      );
    }
  } catch {
    // URL 解析失败时原样返回
  }
  return url;
}

/**
 * HTTPS 页面代理 HTTP 脚本请求
 *
 * 当页面协议为 https:// 且目标脚本 URL 为 http://
 * （排除 localhost / 127.0.0.1）时，通过扩展后台
 * dispatchPageAction('fetch', {url}) 拉取脚本内容，
 * 再以文本形式注入 <head>，绕过浏览器混合内容限制。
 *
 * 其他情况（URL 已被 ipToReviewcook 转换为 https://，
 * 或 URL 本身为 https://，或为 localhost 调试地址）
 * 直接创建 <script src> 并等待其 onload / onerror。
 *
 * @param url - 脚本 URL（会先经过 ipToReviewcook 处理）
 * @returns Promise，脚本加载完成时 resolve 空字符串；
 *          加载失败或代理拉取失败时 reject
 */
export async function ensureHttpsProxy(url: string): Promise<string> {
  const proxiedUrl = ipToReviewcook(url);

  // HTTPS 页面 + 仍为 HTTP URL + 非 localhost → 通过扩展代理 fetch
  if (
    location.protocol === "https:" &&
    /^http:\/\//.test(proxiedUrl) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)/.test(proxiedUrl)
  ) {
    try {
      const content = (await dispatchPageAction("fetch", {
        url: proxiedUrl,
      })) as string;
      const script = document.createElement("script");
      script.textContent = content;
      document.head.appendChild(script);
      // 等待下一轮事件循环，确保 DOM 插入完成
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return "";
    } catch {
      throw new Error(`HTTPS 代理拉取失败: ${proxiedUrl}`);
    }
  }

  // 直接创建 <script src> 注入，等待加载完成
  return new Promise<string>((resolve, reject) => {
    type ScriptWithReadyState = HTMLScriptElement & {
      onreadystatechange?: (this: HTMLScriptElement, ev: Event) => unknown;
      readyState?: string;
    };
    const script = document.createElement("script") as ScriptWithReadyState;
    script.src = proxiedUrl;
    script.setAttribute("data-proxy", "true");

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`脚本加载超时: ${proxiedUrl}`));
      }
    }, 10000);

    const handleLoad = function (this: GlobalEventHandlers) {
      if (settled) return;
      const rs = (this as unknown as ScriptWithReadyState).readyState;
      if (!rs || rs === "loaded" || rs === "complete") {
        settled = true;
        clearTimeout(timeout);
        resolve("");
      }
    };
    script.onload = handleLoad;
    script.onreadystatechange = handleLoad as typeof script.onreadystatechange;

    script.onerror = function () {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`脚本加载失败: ${proxiedUrl}`));
      }
    };

    document.head.appendChild(script);
  });
}
