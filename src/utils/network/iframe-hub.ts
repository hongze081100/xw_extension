/**
 * Iframe Hub — 跨域 iframe 请求代理中心
 *
 * 功能：
 * - 为跨域域名创建隐藏 iframe，利用 postMessage 代理 fetch 请求
 * - 支持普通 fetch 和 SSE 流式请求
 * - 内置 MTOP SDK iframe（淘宝移动端 H5 场景）
 * - 代理 Map 按域名缓存，避免重复创建 iframe
 */

import { runGenerator } from "./generator-runner";

/** iframe 代理实例 */
interface IframeProxy {
  iframe: HTMLIFrameElement;
  isIframeLoaded: boolean;
  requestQueue: Array<() => void>;
  responseQueue: Array<{ uuid: number; resolve: (resp: Response) => void; reject: (err: unknown) => void }>;
}

/** MTOP iframe 实例 */
interface MtopIframeProxy {
  iframe: HTMLIFrameElement;
  isIframeLoaded: boolean;
  mtopRegisterQueue: Array<() => void>;
  mtopResolveQueue: Array<(src: string) => void>;
}

/** 流式请求追踪对象 */
interface StreamProxyEntry {
  iframe: HTMLIFrameElement;
  resolve: (resp: Response) => void;
  reject: (err: Error) => void;
  controller: ReadableStreamDefaultController | null;
}

/** 域名 → IframeProxy */
const domainProxyMap: Record<string, IframeProxy> = {};

/** iframe 创建缓存 key 集合（避免重复创建） */
const iframeKeys = new Set<string>();

/** 流式请求 ID → 追踪对象 */
const streamMap = new Map<number, StreamProxyEntry>();

/** 流式请求自增 ID */
let streamIdCounter = 1;

/** 默认 MTOP iframe src（淘宝 H5 中间页） */
const DEFAULT_MTOP_IFRAME_SRC = "https://h5.m.taobao.com/applink/smb-fid-sender.html";

/** src → MTOP 代理实例 */
const mtopIframeMap: Record<string, MtopIframeProxy> = {};

let messageListenerInstalled = false;

/**
 * 安装全局 message 监听器
 *
 * 处理两类消息：
 * 1. 普通 fetch 响应（action: "fetch"）
 * 2. 流式请求事件（__streamProxy: true + type: meta/chunk/end/error）
 */
function ensureMessageListener(): void {
  if (messageListenerInstalled) return;
  messageListenerInstalled = true;

  window.addEventListener("message", (e: MessageEvent) => {
    const t = e.data as {
      action?: string;
      uuid?: number;
      success?: boolean;
      error?: unknown;
      response?: { responseText: string; status: number; statusText: string; headers: Record<string, string> };
      __streamProxy?: boolean;
      id?: number;
      type?: string;
      meta?: { status: number; statusText: string; headers: Record<string, string> };
      chunk?: Uint8Array;
    };

    if (!t) return;

    // 普通 fetch 响应
    if (t.action === "fetch" && typeof t.uuid === "number") {
      for (const domain in domainProxyMap) {
        const proxy = domainProxyMap[domain];
        const idx = proxy.responseQueue.findIndex((r) => r.uuid === t.uuid);
        if (idx !== -1) {
          const entry = proxy.responseQueue.splice(idx, 1)[0];
          if (t.success && t.response) {
            const { responseText, status, statusText, headers } = t.response;
            const resp = new Response(responseText, {
              status,
              statusText,
              headers: new Headers(headers),
            });
            entry.resolve(resp);
          } else {
            entry.reject(t.error);
          }
          break;
        }
      }
    }

    // 流式请求事件
    if (t.__streamProxy) {
      const entry = streamMap.get(t.id as number);
      if (!entry) return;
      switch (t.type) {
        case "meta": {
          const meta = t.meta!;
          const stream = new ReadableStream({
            start(controller) {
              entry.controller = controller;
            },
            cancel() {
              try {
                entry.iframe.contentWindow?.postMessage(
                  { __streamProxy: true, id: t.id, type: "abort" },
                  "*",
                );
              } catch {}
              streamMap.delete(t.id as number);
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
          entry.controller?.enqueue(t.chunk!);
          break;
        case "end":
          entry.controller?.close();
          streamMap.delete(t.id as number);
          break;
        case "error": {
          const err = new Error((t as unknown as { error?: string }).error || "Stream proxy error");
          entry.controller?.error(err);
          entry.reject(err);
          streamMap.delete(t.id as number);
          break;
        }
      }
    }
  });
}

/**
 * 根据 URL 查找或创建对应域名的 iframe 代理
 */
export function getOrCreateProxy(url: string): IframeProxy {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* 保持原值 */
  }
  if (!domainProxyMap[host]) {
    domainProxyMap[host] = createIframeProxy(url);
  }
  return domainProxyMap[host];
}

/**
 * 创建一个隐藏的跨域 iframe
 */
function createIframeProxy(url: string): IframeProxy {
  const iframe = document.createElement("iframe");
  const requestQueue: Array<() => void> = [];
  const proxy: IframeProxy = {
    iframe,
    isIframeLoaded: false,
    requestQueue,
    responseQueue: [],
  };

  // 附加调试标记，让 iframe 页面脚本识别自己是代理通道
  const sep = url.includes("?") ? "&" : "?";
  iframe.src = url + sep + "guan-iframe-fetch-debug=true";
  iframe.style.display = "none";
  (document.body || document.documentElement).appendChild(iframe);

  let fallback = true;
  const tryFallback = () => {
    if (fallback) {
      iframe.src = new URL(url).origin + "?guan-iframe-fetch-debug=true";
      fallback = false;
    }
  };

  iframe.onload = () => {
    try {
      if (iframe && iframe.contentWindow) {
        proxy.isIframeLoaded = true;
        while (requestQueue.length > 0) {
          requestQueue.shift()!();
        }
        return;
      }
    } catch {}
    tryFallback();
  };
  iframe.onerror = tryFallback;

  return proxy;
}

/**
 * 通过 iframe 执行一次跨域 fetch
 *
 * @param request 请求描述
 * @param events fetch 相关事件（用于传递到 iframe 内部监听）
 * @param proxy 使用的 iframe 代理（为 null 时自动查找）
 * @param isStream 是否为流式请求
 */
export function iframeFetch(
  request: { url: string; method?: string; headers?: Record<string, string>; body?: unknown; credentials?: RequestCredentials },
  events: unknown[] = [],
  proxy: IframeProxy | null = null,
  isStream: boolean = false,
): Promise<Response> {
  ensureMessageListener();
  proxy = proxy || getOrCreateProxy(request.url);

  const { iframe, isIframeLoaded, requestQueue, responseQueue } = proxy;
  const uuid = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  return new Promise<Response>((resolve, reject) => {
    const doSend = () => {
      runGenerator(undefined, [], undefined, function* () {
        try {
          if (!iframe || !iframe.contentWindow) return;

          if (isStream) {
            const streamId = streamIdCounter++;
            streamMap.set(streamId, {
              iframe,
              resolve,
              reject,
              controller: null,
            });

            // 流式请求 60s 超时
            setTimeout(() => {
              const entry = streamMap.get(streamId);
              if (entry) {
                entry.reject(new Error("Stream fetch timeout"));
                streamMap.delete(streamId);
              }
            }, 60_000);

            const headers: Array<[string, string]> = request.headers
              ? [...new Headers(request.headers as HeadersInit).entries()]
              : [];

            iframe.contentWindow.postMessage(
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
            iframe.contentWindow.postMessage(
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
      });
    };

    if (isIframeLoaded) {
      doSend();
    } else {
      requestQueue.push(doSend);
    }

    if (!isStream) {
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
 * MTOP iframe 代理
 *
 * 淘宝 MTOP SDK 在 H5 环境下依赖特定的 jsb bridge，
 * 通过隐藏 iframe 注入官方中间页来桥接。
 */
export function createMtopIframe(args: {
  iframeSrc?: string;
  jsv?: string;
}): Promise<void> {
  const src = args.iframeSrc || DEFAULT_MTOP_IFRAME_SRC;

  let proxy = mtopIframeMap[src];
  if (!proxy) {
    const iframe = document.createElement("iframe");
    proxy = {
      iframe,
      isIframeLoaded: false,
      mtopRegisterQueue: [],
      mtopResolveQueue: [],
    };
    mtopIframeMap[src] = proxy;

    const sep = src.includes("?") ? "&" : "?";
    const source =
      (window as unknown as { $$$guanStorageData?: { mtopSdkSource?: string } }).$$$guanStorageData?.mtopSdkSource || "";
    iframe.src =
      src +
      sep +
      `guan-iframe-mtop-debug=true&jsv=${args.jsv || ""}&source=${encodeURIComponent(source)}`;
    iframe.style.display = "none";
    (document.body || document.documentElement).appendChild(iframe);

    // 监听 iframe 注册成功（iframe 内部会 postMessage({action: "mtopRequest", src})）
    window.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { action?: string; src?: string } | undefined;
      if (
        typeof data === "object" &&
        data &&
        data.action === "mtopRequest" &&
        proxy!.mtopResolveQueue.length > 0
      ) {
        proxy!.mtopResolveQueue.shift()!(data.src || "");
      }
    });

    iframe.onload = () => {
      if (iframe.contentWindow) {
        proxy!.isIframeLoaded = true;
        while (proxy!.mtopRegisterQueue.length > 0) {
          proxy!.mtopRegisterQueue.shift()!();
        }
      }
    };
  }

  if (proxy.isIframeLoaded) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    proxy!.mtopRegisterQueue.push(resolve);
  });
}

/**
 * 通过 MTOP iframe 发送请求
 *
 * @param args 请求描述
 * @param args.jsv JSBridge 版本号
 * @param args.callback 回调名称
 * @param args.params 请求参数（将过滤掉 callback/type/appKey/sign/t/jsv/H5Request 等保留字段）
 */
export function sendMtopRequest(args: {
  jsv?: string;
  callback?: string;
  params: Record<string, unknown>;
}): void {
  const proxy = mtopIframeMap[DEFAULT_MTOP_IFRAME_SRC];
  if (!proxy || !proxy.iframe) {
    console.warn("[MtopIframe] mtop iframe not initialized");
    return;
  }

  const reservedKeys = ["callback", "type", "appKey", "sign", "t", "jsv", "H5Request"];
  const cleanParams: Record<string, unknown> = {};
  for (const key in args.params) {
    if (reservedKeys.indexOf(key) === -1) {
      cleanParams[key] = args.params[key];
    }
  }

  const libMtop = (window as unknown as { lib?: { mtop?: { config?: unknown } } }).lib?.mtop;

  proxy.iframe.contentWindow?.postMessage(
    JSON.stringify({
      action: "mtop",
      jsv: args.jsv,
      callback: args.callback,
      config: libMtop?.config,
      params: cleanParams,
    }),
    "*",
  );
}

/** 清理所有 iframe 代理（页面卸载时调用） */
export function cleanupAllIframes(): void {
  for (const domain in domainProxyMap) {
    const proxy = domainProxyMap[domain];
    try {
      proxy.iframe.remove();
    } catch {}
  }
  for (const src in mtopIframeMap) {
    try {
      mtopIframeMap[src].iframe.remove();
    } catch {}
  }
  streamMap.clear();
}
