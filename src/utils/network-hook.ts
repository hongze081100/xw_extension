/**
 * Network Hook — Fetch / XMLHttpRequest 拦截器
 *
 * 提供请求拦截的基础设施：
 * - 拦截器注册机制（addFetchListener）
 * - 全局 fetch / XMLHttpRequest 替换
 * - Headers 对象转换工具
 * - URL 归一化
 * - 流式请求检测
 */

/** Fetch 请求参数 */
export interface FetchRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: RequestCredentials;
  query?: string;
  [key: string]: unknown;
}

/** Fetch 拦截器上下文 */
export interface FetchContext {
  request: FetchRequest;
  disabled?: boolean;
  respondWith?: (promise: Promise<Response>) => void;
  respondDirectly?: (response: Response) => void;
  onResponse?: (
    handler: (
      response: Response,
      meta?: { url: string; method: string },
    ) => Promise<Response> | Response,
  ) => void;
}

/** Fetch 拦截器函数签名 */
export type FetchInterceptor = (context: FetchContext) => void;

const fetchInterceptors: FetchInterceptor[] = [];
let hooksInstalled = false;

const nativeFetch = window.fetch;
const NativeHeaders = window.Headers;
const NativeRequest = window.Request;
const NativeResponse = window.Response;

const requestPropertyNames: string[] = (() => {
  const dummy = new NativeRequest("") as unknown as Record<string, unknown>;
  const names: string[] = [];
  for (const key in dummy) {
    if (key !== "url" && typeof dummy[key] !== "function") {
      names.push(key);
    }
  }
  return names;
})();

/** 注册 Fetch 拦截器 */
export function addFetchListener(interceptor: FetchInterceptor): void {
  ensureHooksInstalled();
  fetchInterceptors.push(interceptor);
}

/** Headers → 普通对象 */
export function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers.entries) {
    for (const [key, value] of headers.entries()) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

async function parseRequest(request: Request): Promise<FetchRequest> {
  const result: FetchRequest = {
    url: (request as unknown as { url: string }).url,
    method: (request as unknown as { method: string }).method || 'GET',
  };
  for (const key of requestPropertyNames) {
    const val = (request as unknown as Record<string, unknown>)[key];
    if (key !== 'url') {
      if (key === 'headers' && val instanceof NativeHeaders) {
        const h = headersToObject(val as unknown as Headers);
        if (Object.keys(h).length > 0) result.headers = h;
      } else if (typeof val !== 'function') {
        (result as unknown as Record<string, unknown>)[key] = val;
      }
    }
  }
  result.method = result.method || 'GET';
  if (result.method !== 'GET' && result.method !== 'PUT') {
    result.body = await request.text();
  }
  return result;
}

/** URL 归一化 */
export function normalizeUrl(url: string): string {
  const anchor = document.createElement("a");
  anchor.href = url;
  return anchor.href;
}

/** 检测流式响应 */
export function isStreamResponse(response: Response, request?: { headers?: HeadersInit }): boolean {
  const ct = (response.headers.get("content-type") || "").toLowerCase();
  if (
    ct.includes("text/event-stream") ||
    ct.includes("application/x-ndjson") ||
    ct.includes("application/stream+json") ||
    ct.includes("application/stream")
  ) {
    return true;
  }
  if (!request || !request.headers) return false;
  const headers = request.headers as HeadersInit;
  const accept = headers instanceof NativeHeaders ? headers.get("accept") || "" : "";
  return accept.toLowerCase().includes("text/event-stream");
}

/** 根据流式决定 clone 策略 */
export function cloneResponse(response: Response, request?: { headers?: HeadersInit }): Response {
  if (isStreamResponse(response, request)) {
    return new NativeResponse(null as unknown as BodyInit, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response.clone();
}

function runInterceptors(context: FetchContext): void {
  for (const interceptor of fetchInterceptors) {
    if (context.disabled) break;
    interceptor(context);
  }
}

export function ensureHooksInstalled(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  installFetchHook();
  // installXHRHook();
}

/** 全局 fetch 替换 */
function installFetchHook(): void {
  const originalFetch = nativeFetch.bind(window);
  const anyWindow = window as unknown as { fetch: typeof nativeFetch };

  anyWindow.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let parsed: FetchRequest = { url: '', method: 'GET' };

    if (typeof input === 'string') {
      parsed.url = input;
    } else if (input instanceof URL) {
      parsed.url = input.href;
    } else if (input instanceof NativeRequest) {
      parsed = await parseRequest(input);
    } else if (typeof input === 'object') {
      parsed = input as unknown as FetchRequest;
    }

    if (init && typeof init === 'object') {
      const initObj = init as Record<string, unknown>;
      const initParsed: Record<string, unknown> = {};
      for (const key of requestPropertyNames) {
        if (key in initObj) {
          initParsed[key] = initObj[key];
        }
      }
      parsed = { ...parsed, ...initParsed } as FetchRequest;
    }

    if (parsed.url?.startsWith?.('blob:')) {
      return originalFetch(input as RequestInfo, init);
    }

    if (parsed.headers && parsed.headers instanceof NativeHeaders) {
      parsed.headers = headersToObject(parsed.headers as unknown as Headers);
    }

    let respondWithPromise: Promise<Response> | null = null;
    let directResponse: Response | null = null;
    const onResponseHandlers: Array<
      (response: Response, meta?: { url: string; method: string }) => Promise<Response> | Response
    > = [];
    let responseHandled = false;

    const context: FetchContext = {
      request: parsed,
      respondWith: (promise) => {
        context.disabled = true;
        responseHandled = true;
        respondWithPromise = promise;
      },
      respondDirectly: (resp) => {
        context.disabled = true;
        responseHandled = true;
        directResponse = resp;
      },
      onResponse: (handler) => onResponseHandlers.push(handler),
    };

    runInterceptors(context);
    parsed.url = normalizeUrl(parsed.url || '');

    if (directResponse) return directResponse;

    if (!responseHandled) {
      const { url, ...rest } = parsed;
      const nativeResponse = await originalFetch(url, rest as unknown as RequestInit);
      let result: Response = cloneResponse(nativeResponse, parsed as unknown as { headers?: HeadersInit });
      for (const handler of onResponseHandlers) {
        const processed = await handler(result);
        if (processed instanceof NativeResponse) result = processed;
      }
      return result;
    }

    let response: Response = await respondWithPromise!;
    for (const handler of onResponseHandlers) {
      const processed = await handler(response);
      if (processed instanceof NativeResponse) response = processed;
    }
    return response;
  };

  anyWindow.fetch.toString = () => nativeFetch.toString();
  anyWindow.fetch.valueOf = () => nativeFetch.valueOf();
}

/** 全局 XMLHttpRequest 替换 */
function installXHRHook(): void {
  const OriginalXHR = window.XMLHttpRequest;
  const anyWindow = window as unknown as {
    XMLHttpRequest: typeof OriginalXHR;
  };

  interface ProxyXHRImplementation {
    _xhr: XMLHttpRequest;
    _headers: Headers;
    _meta: { url: string; method: string };
    _onResponseQueue: Array<
      (resp: Response, meta?: { url: string; method: string }) => Promise<Response> | Response
    >;
    _eventListeners: Record<string, Array<(ev: Event) => void>>;
    setRequestHeader(name: string, value: string): void;
    open(method: string, url: string, async?: boolean, user?: string, password?: string): void;
    addEventListener(type: string, listener: (ev: Event) => void): void;
    removeEventListener(type: string, listener: (ev: Event) => void): void;
    send(body?: BodyInit | null): void;
    _applyResponse(response: Response): void;
    _fireEvent(type: string): void;
  }

  const ProxyXHR: new () => XMLHttpRequest = function (this: ProxyXHRImplementation) {
    this._xhr = new OriginalXHR();
    this._headers = new NativeHeaders();
    this._meta = { url: "", method: "GET" };
    this._onResponseQueue = [];
    this._eventListeners = {};

    // 代理所有原始属性
    const self = this as unknown as Record<string, unknown>;
    const xhrProto = OriginalXHR.prototype as unknown as Record<string, unknown>;

    const writeableProps = [
      "readyState",
      "response",
      "responseText",
      "responseType",
      "status",
      "statusText",
      "onreadystatechange",
      "onloadstart",
      "onprogress",
      "onabort",
      "onerror",
      "onload",
      "ontimeout",
      "onloadend",
    ];

    for (const prop of writeableProps) {
      Object.defineProperty(this, prop, {
        configurable: true,
        enumerable: true,
        get() {
          const selfAny = self as Record<string, unknown>;
          if (Object.prototype.hasOwnProperty.call(selfAny, "_" + prop)) {
            return selfAny["_" + prop];
          }
          const realXhr = (self as unknown as ProxyXHRImplementation)._xhr as unknown as Record<string, unknown>;
          return realXhr[prop];
        },
        set(val: unknown) {
          const realXhr = (self as unknown as ProxyXHRImplementation)._xhr as unknown as Record<string, unknown>;
          if (typeof val === "function") {
            realXhr[prop] = function (...args: unknown[]) {
              return (val as (...args: unknown[]) => unknown).call(self, ...args);
            };
          } else {
            realXhr[prop] = val;
          }
        },
      });
    }
  } as unknown as new () => XMLHttpRequest;

  (ProxyXHR as unknown as ProxyXHRImplementation).setRequestHeader = function (name: string, value: string) {
    this._headers.set(name, value);
  };

  (ProxyXHR as unknown as ProxyXHRImplementation).open = function (
    method: string,
    url: string,
    async?: boolean,
    user?: string,
    password?: string,
  ) {
    if (user && password) {
      this._headers.set("Authorization", "Basic " + btoa(user + ":" + password));
    }
    this._meta = { method, url };
    try {
      (this._xhr.open as any)(method, url, async ?? true, user, password);
    } catch {}
  };

  (ProxyXHR as unknown as ProxyXHRImplementation).addEventListener = function (type: string, listener: (ev: Event) => void) {
    (this._eventListeners[type] ||= []).push(listener);
    this._xhr.addEventListener(type, listener);
  };

  (ProxyXHR as unknown as ProxyXHRImplementation).removeEventListener = function (type: string, listener: (ev: Event) => void) {
    const list = this._eventListeners[type];
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
    this._xhr.removeEventListener(type, listener);
  };

  (ProxyXHR as unknown as ProxyXHRImplementation).send = function (body?: BodyInit | null) {
    const meta = this._meta;

    const context: FetchContext = {
      request: {
        url: meta.url,
        method: meta.method,
        headers: headersToObject(this._headers as unknown as Headers),
      },
      respondWith: (promise) => {
        context.disabled = true;
        promise.then((response) => this._applyResponse(response));
      },
      respondDirectly: (response) => {
        context.disabled = true;
        this._applyResponse(response);
      },
      onResponse: (handler) => this._onResponseQueue.push(handler),
    };

    runInterceptors(context);

    if (context.disabled) return;

    const requestInit: RequestInit = {
      method: meta.method,
      headers: this._headers as unknown as HeadersInit,
    };
    if (body !== undefined && body !== null) {
      requestInit.body = body;
    }

    nativeFetch(meta.url, requestInit)
      .then((response) => {
        let finalResponse: Response = response;
        const processNext = async (idx: number): Promise<void> => {
          if (idx >= this._onResponseQueue.length) {
            this._applyResponse(finalResponse);
            return;
          }
          const processed = this._onResponseQueue[idx](finalResponse, {
            url: meta.url,
            method: meta.method,
          });
          const result = (await (processed as Promise<Response>)) || processed;
          if (result instanceof NativeResponse) {
            finalResponse = result;
          }
          await processNext(idx + 1);
        };
        processNext(0);
      })
      .catch(() => {
        this._applyResponse(new NativeResponse(""));
      });
  };

  (ProxyXHR as unknown as ProxyXHRImplementation)._applyResponse = function (response: Response) {
    const self = this as unknown as Record<string, unknown>;
    try {
      const headersObj: Record<string, string> = {};
      const allHeaders: string[] = [];
      if (response.headers.entries) {
        for (const [key, value] of response.headers.entries()) {
          headersObj[key.toLowerCase()] = value;
          allHeaders.push(`${key}: ${value}`);
        }
      }

      Object.defineProperty(this, "getAllResponseHeaders", {
        value: () => allHeaders.join("\r\n"),
        configurable: true,
        enumerable: false,
      });
      Object.defineProperty(this, "getResponseHeader", {
        value: (name: string) => headersObj[(name || "").toLowerCase()] || "",
        configurable: true,
        enumerable: false,
      });

      const contentType = response.headers.get("content-type");
      if (/application\/json/.test(contentType || "")) {
        (this as unknown as { responseType: string }).responseType = "json";
        response.json().then((data) => {
          (this as unknown as { response: unknown }).response = data;
          (this as unknown as { responseText: string }).responseText = JSON.stringify(data);
          this._fireEvent("loadend");
        });
      } else {
        response.text().then((text) => {
          (this as unknown as { response: string }).response = text;
          (this as unknown as { responseText: string }).responseText = text;
          this._fireEvent("loadend");
        });
      }
    } catch {
      this._fireEvent("loadend");
    }
  };

  (ProxyXHR as unknown as ProxyXHRImplementation)._fireEvent = function (type: string) {
    const list = this._eventListeners[type];
    if (list) {
      for (const fn of list) {
        try {
          fn(new Event(type));
        } catch {}
      }
    }
  };

  anyWindow.XMLHttpRequest = ProxyXHR as unknown as typeof OriginalXHR;

  anyWindow.XMLHttpRequest.toString = () => OriginalXHR.toString();
  anyWindow.XMLHttpRequest.valueOf = () => OriginalXHR.valueOf();

  const xhrConsts = ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE", "prototype"] as const;
  for (const key of xhrConsts) {
    (anyWindow.XMLHttpRequest as unknown as Record<string, unknown>)[key] = (OriginalXHR as unknown as Record<string, unknown>)[key];
  }
}
