/**
 * HookXhrAndFetch — 全局 HTTP 请求拦截器
 *
 * 劫持 `window.XMLHttpRequest` 和 `window.fetch`，对外暴露统一的拦截器注册入口
 * `window.addGuanFetchListener`。拦截器可以：
 *   - 读取 / 修改请求参数（url、method、headers、body）
 *   - 通过 `respondDirectly` 直接返回模拟响应（短路真实请求）
 *   - 通过 `respondWith(promise)` 异步返回模拟响应
 *   - 通过 `onResponse` 在响应返回后进行二次处理（如解包、替换）
 *
 * 内部实现要点：
 *   - XHR 包装器通过 `defineProperty` 代理所有属性到原始实例
 *   - 对 Streaming 响应（SSE / NDJSON）特殊处理，避免 `bodyUsed` 冲突
 */

// ============================ 通用工具 ============================

/** 浅拷贝对象并剔除指定 key */
function omit<T extends Record<string, any>>(obj: T, keys: string[]): Partial<T> {
  const result: any = {};
  for (const key in obj) {
    if (!keys.includes(key)) result[key] = obj[key];
  }
  return result;
}

// ============================ 全局状态 ============================

type HeadersLike = Headers | Record<string, string>;

/** 请求拦截器上下文：传递给每个监听器 */
interface FetchListenerContext {
  /** 扁平化后的请求参数（url、method、headers、body 等） */
  request: Record<string, any>;
  /** 监听器被标记为 disabled 后会被主循环跳过 */
  disabled?: boolean;
  /** 异步替换响应（短路真实请求） */
  respondWith: (responsePromise: Promise<Response>) => void;
  /** 同步替换响应（短路真实请求） */
  respondDirectly: (response: Response) => void;
  /** 注册响应拦截器：在真实响应返回后可进行二次处理 */
  onResponse: (interceptor: (response: Response, request: Record<string, any>) => Promise<Response | void> | Response | void) => void;
}

/** 拦截器回调签名 */
type FetchListener = (ctx: FetchListenerContext) => void;

/** 已注册的请求拦截器列表 */
const listeners: FetchListener[] = [];

/** XHR / fetch 是否已被劫持（防止重复 patch） */
let isPatched = false;

// 保存原始构造函数引用
const OriginalHeaders = window.Headers;
const OriginalRequest = window.Request;
const OriginalResponse = window.Response;

// ============================ 辅助函数 ============================

/**
 * 将 Headers 对象转为普通对象，key 统一小写
 */
function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers?.entries) return result;
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

/**
 * 将 Request 对象解析为普通的 fetch init 对象
 *
 * 由于 Request 的 body 只能被读取一次，这里对 POST/PUT 请求会直接 `await request.text()`
 * 把 body 内容取出来放进 plain object。
 */
async function requestToPlainObject(request: Request): Promise<Record<string, any>> {
  const dummy = new OriginalRequest('');
  const plain: Record<string, any> = {};

  for (const key in request) {
    const value = (request as any)[key];
    if (typeof value === 'function') continue;
    if (typeof value !== 'object' && value !== (dummy as any)[key]) {
      plain[key] = value;
    } else if (value instanceof OriginalHeaders) {
      const headersObj = headersToObject(value);
      if (Object.keys(headersObj).length > 0) plain.headers = headersObj;
    }
  }

  plain.method = plain.method || 'GET';
  // POST/PUT 需要把 body 读出来，否则会被消费掉
  if (plain.method === 'POST' || plain.method === 'PUT') {
    plain.body = await request.text();
  }
  return plain;
}

/**
 * 通过创建 <a> 元素来规范化 URL（处理相对路径、编码等）
 */
function normalizeUrl(url: string): string {
  const anchor = document.createElement('a');
  anchor.href = url;
  return anchor.href;
}

/**
 * 判断响应是否为流式（SSE / NDJSON）
 *
 * 判定依据：
 *   1. 响应 Content-Type 匹配流式类型
 *   2. 或请求头 Accept 包含 text/event-stream
 *
 * 流式响应不能随意 `.clone()`，否则会触发 body stream locked 报错。
 */
function isStreamingResponse(response: Response, init?: Record<string, any>): boolean {
  if (!response.body || response.bodyUsed) return false;

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (
    contentType.includes('text/event-stream') ||
    contentType.includes('application/x-ndjson') ||
    contentType.includes('application/stream+json') ||
    contentType.includes('application/stream')
  ) {
    return true;
  }

  const accept = init?.headers
    ? (typeof init.headers === 'string'
        ? init.headers
        : init.headers instanceof OriginalHeaders
          ? init.headers.get('accept') || ''
          : (init.headers as any).accept || (init.headers as any).Accept || '')
    : '';

  return accept.toLowerCase().includes('text/event-stream');
}

/**
 * 克隆响应（流式响应直接返回原始 Response，不 clone）
 */
function cloneResponseIfNeeded(response: Response, init: Record<string, any>): Response {
  if (isStreamingResponse(response, init)) {
    return new OriginalResponse(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response.clone();
}

/**
 * 依次通知所有拦截器，拦截器可通过 ctx.disabled 停止后续处理
 */
function notifyListeners(ctx: FetchListenerContext) {
  for (const listener of listeners) {
    if (ctx.disabled) break;
    listener(ctx);
  }
}

// ============================ 劫持 XHR ============================

function patchXHR() {
  const OriginalXHR = window.XMLHttpRequest;

  // eslint-disable-next-line func-names
  const WrappedXHR = function (this: any) {
    const self = this;
    const realXhr = new OriginalXHR();

    // ---- 代理所有原始 XHR 属性 ----
    // 原始 XHR 的属性可能是 getter/setter，需要逐个转发
    for (const key in realXhr) {
      let keyType = '';
      try {
        keyType = typeof (realXhr as any)[key];
      } catch {
        // 某些属性（如 responseXML）在未完成时访问会抛错
      }

      if (keyType === 'function') {
        (self as any)[key] = function (...args: any[]) {
          return (realXhr as any)[key](...args);
        };
      } else {
        Object.defineProperty(self, key, {
          get: () => (self.hasOwnProperty('_' + key) ? self['_' + key] : (realXhr as any)[key]),
          set: (value) => {
            try {
              if (typeof value === 'function') {
                // 函数类型（如 onload）需要绑定到包装器实例
                (realXhr as any)[key] = function (...args: any[]) {
                  return (value as Function).call(self, ...args);
                };
              } else {
                // 通配符请求头不拦截，其余透传到真实 XHR
                if (key !== 'responseType' || value !== 'json') {
                  (realXhr as any)[key] = value;
                }
              }
            } catch {
              // setter 抛错（如部分只读属性），存到本地后备
              self['_' + key] = value;
            }
          },
          enumerable: true,
          configurable: true,
        });
      }
    }

    // ---- 请求状态 ----
    const requestHeaders = new OriginalHeaders();
    const requestInfo: Record<string, any> = { headers: requestHeaders, url: '', method: 'GET' };
    const openOptions: Record<string, any> = {};

    // 代理 setRequestHeader：存到我们的 Headers 里，发送时统一写入
    self.setRequestHeader = function (name: string, value: string) {
      requestHeaders.set(name, value);
    };

    // 代理 open：保存 method/url 和鉴权参数
    self.open = function (method: string, url: string, async?: boolean, user?: string, password?: string) {
      if (user && password) {
        requestHeaders.set('Authorization', 'Basic ' + btoa(user + ':' + password));
      }
      Object.assign(openOptions, { async, user, password });
      Object.assign(requestInfo, { method, url });
    };

    // ---- 自定义事件系统（readystatechange / loadend 不转发给 realXhr）----
    // onreadystatechange / onloadend 使用自己的事件队列，因为 realXhr 的回调不可控
    const listenerMap: Record<string, Function[]> = {};
    const handlerMap: Record<string, Function | null> = {};
    let lastResponse: Response | null = null;

    const addListener = (event: string, handler: Function) => {
      (listenerMap[event] ||= []).push(handler);
    };
    const removeListener = (event: string, handler: Function) => {
      const list = listenerMap[event];
      if (!list) return;
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    };
    const setHandler = (event: string, handler: Function | null) => {
      handlerMap[event] = handler;
    };
    const getHandler = (event: string) => handlerMap[event] || null;
    const dispatch = (event: string, ...args: any[]) => {
      const handler = getHandler(event);
      const list = listenerMap[event] || [];
      ([handler, ...list].filter(Boolean) as Function[]).forEach((fn) => fn.call(self, ...args));
    };

    // onreadystatechange 完全自管
    Object.defineProperty(self, 'onreadystatechange', {
      get: () => getHandler('readystatechange'),
      set: (fn: Function) => setHandler('readystatechange', fn),
      enumerable: true,
      configurable: true,
    });

    // onloadend 需要转发 realXhr 的 loadend 事件（但要等响应拦截器处理完再触发）
    const setupLoadEndForwarder = () => {
      realXhr.addEventListener('loadend', (...args: any[]) => {
        if (self._onResponseRun) {
          // 响应拦截器正在处理，等 onResponseEnd 回调后再触发
          self.onResponseEnd(() => dispatch('loadend', ...args));
        } else {
          dispatch('loadend', ...args);
        }
      });
    };

    Object.defineProperty(self, 'onloadend', {
      get: () => getHandler('loadend'),
      set: (fn: Function) => {
        setHandler('loadend', fn);
        setupLoadEndForwarder();
      },
      enumerable: true,
      configurable: true,
    });

    // 允许响应拦截器注册"在 loadend 之前执行"的回调
    self.onResponseEnd = function (fn: Function) {
      (self.onResponseEndTask ||= []).push(fn);
    };

    // addEventListener / removeEventListener：readystatechange / loadend 自管，其余透传
    self.addEventListener = function (event: string, handler: Function) {
      if (event === 'readystatechange') {
        addListener('readystatechange', handler);
      } else if (event === 'loadend') {
        addListener('loadend', handler);
        setupLoadEndForwarder();
      } else {
        const wrapped = (...args: any[]) => handler.call(self, ...args);
        (handler as any).realFunction = wrapped;
        realXhr.addEventListener(event, wrapped);
      }
    };

    self.removeEventListener = function (event: string, handler: Function) {
      if (event === 'readystatechange') removeListener('readystatechange', handler);
      else if (event === 'loadend') removeListener('loadend', handler);
      else realXhr.removeEventListener(event, (handler as any).realFunction || handler);
    };

    // ---- 响应处理流水线 ----
    // 收集到的 onResponse 拦截器
    const responseInterceptors: Array<(response: Response, request: Record<string, any>) => Promise<Response | void> | Response | void> = [];

    /**
     * 将 Response 写回 XHR 实例并触发事件
     */
    const processResponse = async (event: Event, response: Response) => {
      // 依次执行响应拦截器
      for (const interceptor of responseInterceptors) {
        const next = await interceptor(response.clone(), requestInfo);
        if (next && next instanceof OriginalResponse) response = next;
      }

      // 如果响应有变化，重新填充 XHR 字段
      if (!lastResponse || lastResponse !== response) {
        let rawHeaderStr = '';
        const headerMap: Record<string, string> = {};
        if (response.headers.entries) {
          for (const [key, value] of response.headers.entries()) {
            const lowerKey = key.toLowerCase();
            rawHeaderStr += lowerKey + ': ' + value + '\r\n';
            headerMap[lowerKey] = value;
          }
        }
        self.getAllResponseHeaders = () => rawHeaderStr;
        self.getResponseHeader = (name: string) => headerMap[(name || '').toLowerCase()] || '';

        const contentType = response.headers.get('content-type');
        if (/application\/json/.test(contentType || '') && !self._responseType) {
          self._responseType = 'json';
        }

        if (self.responseType === 'json') {
          self._response = await response.json();
          self._responseText = JSON.stringify(self._response);
        } else if (!self.responseType || self.responseType === 'text') {
          const text = await response.text();
          self.response = self._responseText = text;
        }
      }

      // 派发事件
      dispatch('readystatechange', event);
      dispatch('loadend');
      self._onResponseRun = false;

      // 执行积压的 onResponseEnd 回调
      if (self.onResponseEndTask && self.onResponseEndTask.length > 0) {
        let task: Function | undefined;
        while ((task = self.onResponseEndTask.shift())) task();
      }
    };

    // ---- send：构建拦截器上下文并执行请求 ----
    self.send = function (body?: any) {
      let intercepted = false;

      // 填充 body / 规范化 URL
      if ((requestInfo.method || '').toLowerCase() !== 'get') {
        requestInfo.body = body;
      }
      requestInfo.url = normalizeUrl(requestInfo.url || '');

      // 构建 fetch 风格的请求对象
      const plainHeaders = headersToObject(requestHeaders);
      const requestInit: Record<string, any> = {
        ...omit(requestInfo, ['headers']),
        headers: plainHeaders,
      };

      const ctx: FetchListenerContext = {
        request: requestInit,
        disabled: false,
        respondWith: (promise) => {
          ctx.disabled = true;
          intercepted = true;
          promise.then(
            (resp) => {
              self._readyState = 4;
              self._status = resp.status;
              processResponse(new Event('fetch'), resp);
            },
            () => {
              self._readyState = 4;
              processResponse(new Event('fetch'), new OriginalResponse(''));
            },
          );
        },
        respondDirectly: (resp) => {
          ctx.disabled = true;
          intercepted = true;
          self._readyState = 4;
          self._status = resp.status;
          processResponse(new Event('fetch'), resp);
        },
        onResponse: (fn) => {
          responseInterceptors.push(fn as any);
        },
      };

      notifyListeners(ctx);

      // 如果没有被拦截，走真实 XHR
      if (!intercepted || openOptions.async === false) {
        const { method, url } = ctx.request;
        const headers = ctx.request.headers || {};
        const { async, user, password } = openOptions;

        realXhr.onreadystatechange = (evt: Event) => {
          if (realXhr.readyState === 4 && realXhr.status === 200) {
            // 从真实 XHR 构造 Response 对象
            let rawBody: any = realXhr.response;
            if (realXhr.responseType === 'json') rawBody = JSON.stringify(rawBody);

            const headersMap: Record<string, string> = {};
            realXhr
              .getAllResponseHeaders()
              .trim()
              .split(/[\r\n]+/)
              .forEach((line) => {
                const [key, ...rest] = line.split(/\s*:\s*/);
                if (key) headersMap[key] = rest.join(':');
              });

            const response = (lastResponse = new OriginalResponse(rawBody, { headers: headersMap }));
            self._onResponseRun = true;
            processResponse(evt, response);
          } else {
            dispatch('readystatechange', evt);
          }
        };

        realXhr.open(method, url, async !== false, user, password);

        // 转发预设的 responseType
        if (self.hasOwnProperty('_responseType')) {
          realXhr.responseType = self._responseType;
        }

        Object.keys(headers).forEach((key) => {
          realXhr.setRequestHeader(key, headers[key]);
        });

        realXhr.send(ctx.request.body);
      }
    };
  };

  // 替换全局 XMLHttpRequest（类型断言避免 TS 构造函数签名不兼容）
  (window as any).XMLHttpRequest = WrappedXHR;

  // 保留原始 XHR 的静态方法和常量
  WrappedXHR.toString = OriginalXHR.toString.bind(OriginalXHR);
  WrappedXHR.valueOf = OriginalXHR.valueOf.bind(OriginalXHR);
  ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE', 'prototype'].forEach(
    (name) => {
      (WrappedXHR as any)[name] = (OriginalXHR as any)[name];
    },
  );
}

// ============================ 劫持 fetch ============================

/** Request 对象上的可枚举自有属性列表（排除 url 和方法） */
const REQUEST_KEYS: string[] = (() => {
  const keys: string[] = [];
  const dummy = new OriginalRequest('');
  for (const key in dummy) {
    if (key !== 'url' && typeof (dummy as any)[key] !== 'function') {
      keys.push(key);
    }
  }
  return keys;
})();

function patchFetch() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (this: any, input: any, init?: any): Promise<Response> {
    // ---- 解析 input 为普通请求对象 ----
    let requestInit: Record<string, any> = {};

    if (typeof input === 'string') {
      requestInit.url = input;
    } else if (input instanceof URL) {
      requestInit.url = input.href;
    } else if (input instanceof OriginalRequest) {
      requestInit = await requestToPlainObject(input);
    } else if (input && typeof input === 'object') {
      requestInit = input;
    }

    // ---- 解析 init 对象 ----
    if (init && typeof init === 'object') {
      if (init instanceof OriginalRequest) {
        init = await requestToPlainObject(init);
      } else {
        // 只保留 Request 上存在的属性（过滤掉多余的自定义字段）
        init = Object.keys(init).reduce<Record<string, any>>((acc, key) => {
          if (REQUEST_KEYS.includes(key)) acc[key] = init[key];
          return acc;
        }, {});
      }
    }

    // ---- 合并 ----
    const merged: Record<string, any> = { ...requestInit, ...(init || {}) };

    // blob: URL 不走代理（由浏览器内部处理）
    if (merged.url?.startsWith?.('blob:')) {
      return originalFetch(input, init);
    }

    // Headers 转为普通对象
    if (merged.headers instanceof OriginalHeaders) {
      merged.headers = headersToObject(merged.headers);
    }

    // ---- 构建拦截器上下文 ----
    let interceptorUsed = false;
    let directResponse: Response | null = null;
    const responseInterceptors: Array<(response: Response, request: Record<string, any>) => Promise<Response | void> | Response | void> = [];
    let resolveFn: (resp: Response) => void = () => {};
    let rejectFn: (err: any) => void = (err) => console.log(err);

    /** 响应拦截器流水线 */
    const processResponse = async (response: Response): Promise<void> => {
      try {
        let current = response;
        for (const interceptor of responseInterceptors) {
          const next = await interceptor(cloneResponseIfNeeded(current, merged), merged);
          if (next && next instanceof OriginalResponse) current = next;
        }
        resolveFn(current);
      } catch (err) {
        console.error('[Guan fetchProxy] fetch onResponseEnd 异常', { url: merged.url, err });
        rejectFn(err);
      }
    };

    merged.url = normalizeUrl(merged.url || '');

    const ctx: FetchListenerContext = {
      request: merged,
      disabled: false,
      respondWith: (promise) => {
        ctx.disabled = true;
        interceptorUsed = true;
        promise.then(processResponse, rejectFn);
      },
      respondDirectly: (resp) => {
        ctx.disabled = true;
        interceptorUsed = true;
        directResponse = resp;
      },
      onResponse: (fn) => {
        responseInterceptors.push(fn as any);
      },
    };

    notifyListeners(ctx);

    // ---- 根据拦截情况决定返回值 ----
    return new Promise<Response>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;

      if (directResponse) {
        resolve(directResponse);
      } else if (!interceptorUsed) {
        // 没有拦截器短路，走真实 fetch
        const { url } = ctx.request;
        const rest = omit(ctx.request, ['url']);
        originalFetch(url, rest as RequestInit)
          .then(processResponse)
          .catch(reject);
      }
      // 否则等待 respondWith 的 Promise 完成
    });
  };

  window.fetch.toString = originalFetch.toString.bind(originalFetch);
  window.fetch.valueOf = originalFetch.valueOf.bind(originalFetch);
}

// ============================ 对外 API ============================

/**
 * 注册请求拦截器（幂等：首次注册时自动劫持 XHR / fetch）
 */
function installPatches() {
  if (isPatched) return;
  isPatched = true;
  patchXHR();
  patchFetch();
}

/**
 * 添加全局 HTTP 请求监听器
 *
 * 每个监听器在请求发出前被调用一次，通过 ctx 读取 / 修改请求，
 * 或直接短路返回模拟响应。
 */
// (window as any).addGuanFetchListener = (listener: FetchListener) => {
//   installPatches();
//   listeners.push(listener);
// };
