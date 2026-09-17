/**
 * iframe-proxy — 跨域 iframe 请求代理
 *
 * 从 content_kd.js Module 987（约 1343–1495 行）提取并改写。
 * 在目标域名上创建隐藏 iframe，通过 postMessage 代理 fetch 请求，
 * 从而绕过浏览器同源策略的 CORS 限制。
 *
 * 本模块纯 DOM + postMessage，不依赖内部工具，使用原生 async/await。
 *
 * 支持两类请求：
 *   1. 普通 fetch — 发送 `{action:'fetch', uuid, request, events}`，
 *      等待匹配 uuid 的响应消息返回完整 Response。
 *   2. 流式 fetch — 发送 `{__streamProxy:true, id, type:'start', ...}`，
 *      通过 ReadableStream 接收 meta / chunk / end / error 四阶段事件。
 *
 * 所有请求均带 60 秒超时保护。
 */

/**
 * 单个跨域 iframe 代理实例
 *
 * 每个目标域名对应一个实例，内部持有：
 * - iframe DOM 元素
 * - 加载状态标记
 * - 请求/响应队列（iframe 未就绪时排队）
 */
export interface IframeInstance {
  /** 隐藏的 iframe DOM 元素 */
  iframe: HTMLIFrameElement;
  /** iframe 是否已加载完毕（onload 触发后置 true） */
  isIframeLoaded: boolean;
  /** 等待 iframe 加载完成后依次执行的请求任务队列 */
  requestQueue: Array<() => void>;
  /** 已发送、待匹配响应的请求条目 */
  responseQueue: Array<{
    uuid: number;
    resolve: (resp: Response) => void;
    reject: (err: unknown) => void;
  }>;
}

/**
 * 流式请求追踪条目
 *
 * 与非流式不同，流式请求不使用 responseQueue，
 * 而是单独维护一个 Map：key 是自增 id，value 是本结构。
 * 当收到 meta 消息时，我们构造 ReadableStream 并把 controller 填进来；
 * 后续 chunk / end / error 事件直接驱动 controller。
 */
export interface StreamProxyEntry {
  /** 所属 iframe（abort 时要 postMessage 回去） */
  iframe: HTMLIFrameElement;
  /** 构造完毕的 Response 要 resolve 给谁 */
  resolve: (resp: Response) => void;
  /** 流式启动阶段出错时 reject */
  reject: (err: Error) => void;
  /** ReadableStream 的控制器，收到 meta 后赋值 */
  controller: ReadableStreamDefaultController | null;
}

/**
 * 普通 fetch 请求描述
 *
 * 与标准 RequestInit 类似，但 body 保持 unknown（可能被 JSON 序列化），
 * headers 既可以是对象也可以是 Headers 实例。
 */
export interface IframeFetchRequest {
  /** 完整 URL（用于确定目标域名） */
  url: string;
  /** HTTP 方法，默认 GET */
  method?: string;
  /** 请求头 */
  headers?: Record<string, string> | HeadersInit;
  /** 请求体（iframe 内会被重新组装） */
  body?: unknown;
  /** 凭证模式 */
  credentials?: RequestCredentials;
}

/** 域名 -> IframeInstance */
const _iframeMap: Record<string, IframeInstance> = {};

/** 流式请求 id -> StreamProxyEntry */
const _streamProxyMap: Map<number, StreamProxyEntry> = new Map();

/** 流式请求自增 id（从 1 开始） */
let _streamIdCounter = 1;

/** 消息监听器是否已注册（保证模块级只 addEventListener 一次） */
let _messageListenerInstalled = false;

/**
 * 解析出 URL 的 host 部分，失败时原样返回
 */
function _parseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 创建一个隐藏的跨域 iframe 代理实例
 *
 * @param url 目标 URL（可能是完整 URL 或原始 origin）
 * @returns 新建的 IframeInstance（iframe 尚未加载完毕）
 */
function _createIframe(url: string): IframeInstance {
  const iframe = document.createElement("iframe");
  const requestQueue: Array<() => void> = [];
  const instance: IframeInstance = {
    iframe,
    isIframeLoaded: false,
    requestQueue,
    responseQueue: [],
  };

  const sep = url.includes("?") ? "&" : "?";
  iframe.src = url + sep + "guan-iframe-fetch-debug=true";
  iframe.style.display = "none";
  (document.body || document.documentElement).appendChild(iframe);

  /** 是否还可以尝试 origin 兜底（只兜底一次） */
  let canFallback = true;

  const fallbackToOrigin = () => {
    if (canFallback) {
      try {
        iframe.src = new URL(url).origin + "?guan-iframe-fetch-debug=true";
      } catch {
        /* URL 不合法，放弃兜底 */
      }
      canFallback = false;
    }
  };

  iframe.onload = () => {
    try {
      if (iframe && iframe.contentWindow) {
        instance.isIframeLoaded = true;
        while (requestQueue.length > 0) {
          const task = requestQueue.shift();
          if (task) task();
        }
        return;
      }
    } catch {
      /* 跨域访问 contentWindow 抛错，继续兜底 */
    }
    fallbackToOrigin();
  };

  iframe.onerror = fallbackToOrigin;

  return instance;
}

/**
 * 获取（或创建）指定域名的 iframe 代理实例
 *
 * @param url 任意完整 URL，从中解析出 host 作为缓存 key
 * @returns 该 host 对应的 IframeInstance
 */
export function getIframe(url: string): IframeInstance {
  const host = _parseHost(url);
  if (!_iframeMap[host]) {
    _iframeMap[host] = _createIframe(url);
  }
  return _iframeMap[host];
}

/**
 * 确保全局 message 监听器已安装
 *
 * 处理两类消息：
 *   1. `action === "fetch"`            — 普通 fetch 响应
 *   2. `__streamProxy === true`        — 流式事件（meta / chunk / end / error）
 *
 * 幂等：只会 addEventListener 一次。
 */
function _ensureMessageListener(): void {
  if (_messageListenerInstalled) return;
  _messageListenerInstalled = true;

  window.addEventListener("message", (e: MessageEvent) => {
    const data = e.data as
      | {
          action?: string;
          uuid?: number;
          success?: boolean;
          error?: unknown;
          response?: {
            responseText: string;
            status: number;
            statusText: string;
            headers: Record<string, string>;
          };
          __streamProxy?: boolean;
          id?: number;
          type?: string;
          meta?: {
            status: number;
            statusText: string;
            headers: Record<string, string>;
          };
          chunk?: Uint8Array;
        }
      | undefined;

    if (!data) return;

    // ---- 普通 fetch 响应 ----
    if (data.action === "fetch" && typeof data.uuid === "number") {
      for (const domain in _iframeMap) {
        const proxy = _iframeMap[domain];
        const idx = proxy.responseQueue.findIndex((entry) => entry.uuid === data.uuid);
        if (idx !== -1) {
          const entry = proxy.responseQueue.splice(idx, 1)[0];
          if (data.success && data.response) {
            const { responseText, status, statusText, headers } = data.response;
            const resp = new Response(responseText, {
              status,
              statusText,
              headers: new Headers(headers),
            });
            entry.resolve(resp);
          } else {
            entry.reject(data.error);
          }
          break;
        }
      }
    }

    // ---- 流式事件 ----
    if (data.__streamProxy && typeof data.id === "number") {
      const streamId = data.id;
      const entry = _streamProxyMap.get(streamId);
      if (!entry) return;

      switch (data.type) {
        case "meta": {
          const meta = data.meta!;
          const stream = new ReadableStream({
            start(controller) {
              entry.controller = controller;
            },
            cancel(reason) {
              try {
                entry.iframe.contentWindow?.postMessage(
                  { __streamProxy: true, id: streamId, type: "abort", reason },
                  "*",
                );
              } catch {
                /* ignore */
              }
              _streamProxyMap.delete(streamId);
            },
          });
          const response = new Response(stream, {
            status: meta.status,
            statusText: meta.statusText,
            headers: new Headers(meta.headers),
          });
          entry.resolve(response);
          break;
        }
        case "chunk":
          entry.controller?.enqueue(data.chunk!);
          break;
        case "end":
          entry.controller?.close();
          _streamProxyMap.delete(streamId);
          break;
        case "error": {
          const err = new Error(
            (data as unknown as { error?: string }).error || "Stream proxy error",
          );
          entry.controller?.error(err);
          entry.reject(err);
          _streamProxyMap.delete(streamId);
          break;
        }
      }
    }
  });
}

/**
 * 通过 iframe 代理执行一次跨域 fetch 请求
 *
 * @param request 请求描述（必须包含 url）
 * @param events  透传给 iframe 内部的事件钩子列表（默认 []）
 * @param iframe  指定已存在的代理实例；为空时会自动通过 getIframe(request.url) 获取
 * @param isStream 是否为流式请求
 * @returns Promise<Response>
 *          - 非流式：在普通 Response 上 resolve（或超时/错误 reject）
 *          - 流式：Response.body 为 ReadableStream，数据来自父页面消息驱动
 */
export function iframeFetch(
  request: IframeFetchRequest,
  events: unknown[] = [],
  iframe: IframeInstance | null = null,
  isStream: boolean = false,
): Promise<Response> {
  _ensureMessageListener();
  iframe = iframe || getIframe(request.url);

  const { iframe: el, isIframeLoaded, requestQueue, responseQueue } = iframe;
  const uuid = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  return new Promise<Response>((resolve, reject) => {
    /** 实际发送动作（放在函数里，便于延迟到 iframe 加载完成后执行） */
    const doSend = async () => {
      try {
        if (!el || !el.contentWindow) return;

        if (isStream) {
          const streamId = _streamIdCounter++;
          _streamProxyMap.set(streamId, {
            iframe: el,
            resolve,
            reject,
            controller: null,
          });

          // 60 秒超时保护：如果 meta 迟迟没回来，整条流废弃
          setTimeout(() => {
            const entry = _streamProxyMap.get(streamId);
            if (entry) {
              entry.reject(new Error("Stream fetch timeout"));
              _streamProxyMap.delete(streamId);
            }
          }, 60_000);

          const headers: Array<[string, string]> = request.headers
            ? [...new Headers(request.headers as HeadersInit).entries()]
            : [];

          el.contentWindow.postMessage(
            {
              __streamProxy: true,
              id: streamId,
              type: "start",
              to: request.url,
              events,
              req: {
                method: request.method || "GET",
                headers,
                body: request.body,
                credentials: request.credentials,
              },
            },
            "*",
          );
        } else {
          el.contentWindow.postMessage(
            {
              action: "fetch",
              uuid,
              request: JSON.parse(JSON.stringify(request)),
              events,
            },
            "*",
          );
        }
      } catch (e) {
        reject(e);
      }
    };

    if (isIframeLoaded) {
      // 已加载 → 立即发送
      doSend();
    } else {
      // 未加载 → 排队，onload 后逐个 flush
      requestQueue.push(doSend);
    }

    if (!isStream) {
      // 非流式：把 resolve/reject 放进 responseQueue 等待匹配 uuid
      const timeout = setTimeout(() => reject(new Error("iframe fetch timeout")), 60_000);
      responseQueue.push({
        uuid,
        resolve: (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    }
  });
}

/**
 * 清理所有 iframe 代理
 *
 * 页面卸载时调用，移除 DOM 节点并清空缓存，
 * 避免残留 iframe 继续占用内存或触发 postMessage。
 */
export function cleanupIframeProxy(): void {
  for (const domain in _iframeMap) {
    try {
      const el = _iframeMap[domain].iframe;
      if (el.parentNode) el.parentNode.removeChild(el);
    } catch {
      /* ignore */
    }
  }
  for (const id of _streamProxyMap.keys()) {
    const entry = _streamProxyMap.get(id);
    try {
      entry?.iframe.contentWindow?.postMessage(
        { __streamProxy: true, id, type: "abort" },
        "*",
      );
    } catch {
      /* ignore */
    }
  }
  _streamProxyMap.clear();
}
