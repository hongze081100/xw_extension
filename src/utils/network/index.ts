// ==================== 类型定义 ====================

interface InterceptorRequest {
  request: Request
  mockedResponse: Response | null
}

interface InterceptorResponse {
  response: Response
  request: Request
  setResponse(newResponse: Response): void
}

interface InterceptorContext {
  request: Request
  setRequest(newRequest: Request): void
  setHeader(name: string, value: string): void
  setBody(body: BodyInit | null): void
  respondWith(response: Response): void
}

interface Interceptor {
  onRequest?(context: InterceptorContext): void | Promise<void>
  onResponse?(context: InterceptorResponse): void | Promise<void>
  onError?(error: Error, request: Request): void | Promise<void>
}

interface XHRMeta {
  method: string
  url: string
  headers: Record<string, string>
  async: boolean
}

// ==================== 全局状态 ====================

const interceptors: Interceptor[] = []
let isInitialized = false

// ==================== 通用工具 ====================

/** GET / HEAD 按 HTTP 语义不允许携带 body */
function methodAllowsBody(method: string): boolean {
  return !/^(GET|HEAD)$/i.test(method)
}

// ==================== 拦截器管理 ====================

export function addInterceptor(interceptor: Interceptor) {
  interceptors.push(interceptor)
}

export function removeInterceptor(interceptor: Interceptor) {
  const index = interceptors.indexOf(interceptor)
  if (index > -1) {
    interceptors.splice(index, 1)
  }
}

function createInterceptorContext(request: InterceptorRequest): InterceptorContext {
  return {
    request: request.request,
    setRequest(newRequest: Request) {
      request.request = newRequest
    },
    setHeader(name: string, value: string) {
      const newHeaders = new Headers(request.request.headers)
      newHeaders.set(name, value)
      const newRequest = new Request(request.request, { headers: newHeaders })
      request.request = newRequest
    },
    setBody(body: BodyInit | null) {
      // GET / HEAD 不允许 body，按 HTTP 语义忽略（与原生 XHR send(body) 一致）
      if (!methodAllowsBody(request.request.method)) {
        if (body !== null && body !== undefined) {
          console.warn(
            `[hookNetwork] setBody ignored: ${request.request.method} request cannot have body`,
          )
        }
        return
      }
      const newRequest = new Request(request.request, { body })
      request.request = newRequest
    },
    respondWith(response: Response) {
      request.mockedResponse = response
    },
  }
}

async function runRequestInterceptors(request: InterceptorRequest) {
  const context = createInterceptorContext(request)
  for (const interceptor of interceptors) {
    if (interceptor.onRequest) {
      await interceptor.onRequest(context)
      // 一旦命中 mock，不再往下跑（后续拦截器不会再有机会覆盖）
      if (request.mockedResponse) break
    }
  }
}

async function runResponseInterceptors(responseContext: InterceptorResponse) {
  for (const interceptor of interceptors) {
    if (interceptor.onResponse) {
      await interceptor.onResponse(responseContext)
    }
  }
}

async function runErrorInterceptors(error: Error, request: Request) {
  for (const interceptor of interceptors) {
    if (interceptor.onError) {
      await interceptor.onError(error, request)
    }
  }
}

// ==================== 通用工具 ====================

/** 判断响应头 content-type 是否表示 JSON */
function isJsonContentType(headers: Headers): boolean {
  const ct = headers.get('content-type') || ''
  return ct.toLowerCase().includes('application/json')
}

/** 需要代理的所有 XHR 事件类型 */
const PROXIED_EVENT_TYPES = [
  'readystatechange',
  'loadstart',
  'progress',
  'abort',
  'error',
  'load',
  'timeout',
  'loadend',
] as const

type ProxiedEventType = (typeof PROXIED_EVENT_TYPES)[number]

interface ListenerEntry {
  listener: EventListenerOrEventListenerObject
  options?: AddEventListenerOptions | boolean
}

// ==================== XHR 拦截 ====================

function patchXHR() {
  const OriginalXHR = window.XMLHttpRequest

  class HookedXMLHttpRequest {
    // ---- 静态常量 ----
    static readonly UNSENT = 0
    static readonly OPENED = 1
    static readonly HEADERS_RECEIVED = 2
    static readonly LOADING = 3
    static readonly DONE = 4

    // ---- 实例常量 ----
    readonly UNSENT = 0
    readonly OPENED = 1
    readonly HEADERS_RECEIVED = 2
    readonly LOADING = 3
    readonly DONE = 4

    // ---- 内部状态 ----
    private _xhr: XMLHttpRequest
    private _meta: XHRMeta
    private _skipIntercept = false
    private _openUsername?: string | null
    private _openPassword?: string | null

    /**
     * 拦截器最终确定的响应头（序列化为 `key: value\r\n` 形式）。
     * - Mock 路径：始终写入。
     * - 真实路径：仅当拦截器改写了 response 时写入，否则保持 undefined，
     *   让 `getAllResponseHeaders` / `getResponseHeader` 回落到原生。
     */
    private _overriddenHeaders?: string

    private _timeout = 0
    private _withCredentials = false
    private _responseType: XMLHttpRequestResponseType = ''

    // 供 _handleNativeEvent 使用
    private _baseRequest: Request | null = null
    private _responseInterceptorsRan = false
    private _mockActive = false

    // ---- 事件处理器/监听器全部保存在 Hooked 实例上 ----
    private _eventHandlers = new Map<
      ProxiedEventType,
      ((this: XMLHttpRequest, ev: Event) => any) | null
    >()
    private _eventListeners = new Map<ProxiedEventType, ListenerEntry[]>()

    constructor() {
      // 使用 patch 前捕获的 OriginalXHR，避免递归
      this._xhr = new OriginalXHR()
      this._meta = { method: '', url: '', headers: {}, async: true }

      // 在原生 XHR 上挂载转发器：原生事件先经 _handleNativeEvent（含拦截器），
      // 再统一交由 _dispatchHookedEvent 分发给用户。
      for (const type of PROXIED_EVENT_TYPES) {
        this._xhr.addEventListener(type, (event: Event) => {
          void this._handleNativeEvent(type, event)
        })
      }
    }

    // ==================== 统一事件入口 ====================

    private async _handleNativeEvent(type: ProxiedEventType, event: Event): Promise<void> {
      if (this._skipIntercept || this._mockActive) {
        this._dispatchHookedEvent(type, event)
        return
      }

      try {
        if (
          type === 'readystatechange' &&
          this._xhr.readyState === 4 &&
          !this._responseInterceptorsRan
        ) {
          this._responseInterceptorsRan = true
          await this._runRealResponseInterceptors()
        } else if (type === 'error') {
          if (this._baseRequest) {
            await runErrorInterceptors(new Error('XHR error'), this._baseRequest)
          }
        } else if (type === 'abort') {
          if (this._baseRequest) {
            await runErrorInterceptors(new Error('XHR aborted'), this._baseRequest)
          }
        }
      } catch (err) {
        console.error('[hookNetwork] interceptor error:', err)
      }

      this._dispatchHookedEvent(type, event)
    }

    /** 从原生 xhr 构建 Response，跑一遍响应拦截器 */
    private async _runRealResponseInterceptors(): Promise<void> {
      const xhr = this._xhr
      const baseRequest = this._baseRequest!

      const responseHeaders: Record<string, string> = {}
      const allHeaders = xhr.getAllResponseHeaders()
      if (allHeaders) {
        allHeaders.split('\r\n').forEach((line) => {
          const colonIndex = line.indexOf(': ')
          if (colonIndex === -1) return
          const key = line.substring(0, colonIndex)
          const value = line.substring(colonIndex + 2)
          if (key) responseHeaders[key.toLowerCase()] = value
        })
      }

      // 按 responseType 选择 body，避免 responseText 在非 text 类型下抛错
      let body: BodyInit | null
      const rt = xhr.responseType
      if (rt === '' || rt === 'text') {
        body = xhr.responseText
      } else if (rt === 'json') {
        body = xhr.response ? JSON.stringify(xhr.response) : null
      } else {
        body = (xhr.response as BodyInit) ?? null
      }

      const response = new Response(body, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      })

      const responseContext: InterceptorResponse = {
        response,
        request: baseRequest,
        setResponse(newResponse: Response) {
          this.response = newResponse
        },
      }

      await runResponseInterceptors(responseContext)

      // 若拦截器改写了响应，将最终响应同步回原生 xhr
      if (responseContext.response !== response) {
        const modifiedResponse = responseContext.response

        Object.defineProperty(xhr, 'status', {
          value: modifiedResponse.status,
          writable: true,
          configurable: true,
        })
        Object.defineProperty(xhr, 'statusText', {
          value: modifiedResponse.statusText,
          writable: true,
          configurable: true,
        })

        const modifiedHeaders: string[] = []
        modifiedResponse.headers.forEach((value, key) => {
          modifiedHeaders.push(`${key}: ${value}`)
        })
        this._overriddenHeaders = modifiedHeaders.join('\r\n')

        await this._applyResponseBody(xhr, modifiedResponse)
      }
    }

    /**
     * 按 `_responseType` 与响应的 content-type 将 Response 的 body 写入原生 xhr。
     */
    private async _applyResponseBody(
      xhr: XMLHttpRequest,
      response: Response,
    ): Promise<void> {
      const define = (name: string, value: unknown) => {
        Object.defineProperty(xhr, name, { value, writable: true, configurable: true })
      }

      const rt = this._responseType
      const text = await response.clone().text()
      const jsonByContentType = isJsonContentType(response.headers)

      // 情况 A：responseType 未指定 / text —— 根据 content-type 决定是否 JSON 解析
      if (rt === '' || rt === 'text') {
        if (jsonByContentType) {
          let json: unknown = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = null
          }
          define('responseText', text)
          define('response', json)
          define('responseXML', null)
          return
        }

        define('responseText', text)
        define('response', text)
        define('responseXML', null)
        return
      }

      // 情况 B：responseType === 'json'
      if (rt === 'json') {
        let json: unknown = null
        try {
          json = text ? JSON.parse(text) : null
        } catch {
          json = null
        }
        define('responseText', text)
        define('response', json)
        define('responseXML', null)
        return
      }

      if (rt === 'blob') {
        const blob = await response.clone().blob()
        define('responseText', text)
        define('response', blob)
        define('responseXML', null)
        return
      }

      if (rt === 'arraybuffer') {
        const ab = await response.clone().arrayBuffer()
        define('responseText', text)
        define('response', ab)
        define('responseXML', null)
        return
      }

      if (rt === 'document') {
        const doc = new DOMParser().parseFromString(text, 'text/html')
        define('responseText', text)
        define('response', doc)
        define('responseXML', doc)
        return
      }
    }

    private _dispatchHookedEvent(type: ProxiedEventType, event: Event): void {
      const attrHandler = this._eventHandlers.get(type)
      if (typeof attrHandler === 'function') {
        try {
          ;(attrHandler as Function).call(this, event)
        } catch (err) {
          console.error('[hookNetwork] handler error:', err)
        }
      }

      const list = this._eventListeners.get(type)
      if (list && list.length) {
        for (const entry of list.slice()) {
          try {
            if (typeof entry.listener === 'function') {
              ;(entry.listener as EventListener).call(this, event)
            } else if (
              entry.listener &&
              typeof (entry.listener as EventListenerObject).handleEvent === 'function'
            ) {
              ;(entry.listener as EventListenerObject).handleEvent(event)
            }
          } catch (err) {
            console.error('[hookNetwork] listener error:', err)
          }
          if (
            entry.options &&
            typeof entry.options === 'object' &&
            (entry.options as AddEventListenerOptions).once
          ) {
            const arr = this._eventListeners.get(type)
            if (arr) {
              const idx = arr.indexOf(entry)
              if (idx > -1) arr.splice(idx, 1)
            }
          }
        }
      }
    }

    // ==================== 属性代理 ====================

    get readyState() {
      return this._xhr.readyState
    }
    get status() {
      return this._xhr.status
    }
    get statusText() {
      return this._xhr.statusText
    }
    get response() {
      return this._xhr.response
    }
    get responseText() {
      return this._xhr.responseText
    }
    get responseXML() {
      return this._xhr.responseXML
    }
    get responseURL() {
      return this._xhr.responseURL
    }
    get upload() {
      return this._xhr.upload
    }

    get responseType() {
      return this._responseType
    }
    set responseType(v: XMLHttpRequestResponseType) {
      this._responseType = v
    }

    get timeout() {
      return this._timeout
    }
    set timeout(v: number) {
      this._timeout = v
    }

    get withCredentials() {
      return this._withCredentials
    }
    set withCredentials(v: boolean) {
      this._withCredentials = v
    }

    // ==================== 事件处理器属性代理 ====================

    get onreadystatechange() {
      return this._eventHandlers.get('readystatechange') || null
    }
    set onreadystatechange(v) {
      this._eventHandlers.set('readystatechange', v as any)
    }

    get onloadstart() {
      return this._eventHandlers.get('loadstart') || null
    }
    set onloadstart(v) {
      this._eventHandlers.set('loadstart', v as any)
    }

    get onprogress() {
      return this._eventHandlers.get('progress') || null
    }
    set onprogress(v) {
      this._eventHandlers.set('progress', v as any)
    }

    get onabort() {
      return this._eventHandlers.get('abort') || null
    }
    set onabort(v) {
      this._eventHandlers.set('abort', v as any)
    }

    get onerror() {
      return this._eventHandlers.get('error') || null
    }
    set onerror(v) {
      this._eventHandlers.set('error', v as any)
    }

    get onload() {
      return this._eventHandlers.get('load') || null
    }
    set onload(v) {
      this._eventHandlers.set('load', v as any)
    }

    get ontimeout() {
      return this._eventHandlers.get('timeout') || null
    }
    set ontimeout(v) {
      this._eventHandlers.set('timeout', v as any)
    }

    get onloadend() {
      return this._eventHandlers.get('loadend') || null
    }
    set onloadend(v) {
      this._eventHandlers.set('loadend', v as any)
    }

    // ==================== 事件方法代理 ====================

    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ): void {
      const key = type as ProxiedEventType
      const arr = this._eventListeners.get(key) || []
      arr.push({ listener, options })
      this._eventListeners.set(key, arr)
    }

    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      _options?: EventListenerOptions | boolean,
    ): void {
      const key = type as ProxiedEventType
      const arr = this._eventListeners.get(key)
      if (!arr) return
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].listener === listener) {
          arr.splice(i, 1)
        }
      }
    }

    dispatchEvent(event: Event): boolean {
      this._dispatchHookedEvent(event.type as ProxiedEventType, event)
      return true
    }

    // ==================== 核心方法 ====================

    open(
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null,
    ) {
      if (arguments.length >= 3 && !async) {
        this._skipIntercept = true
      } else {
        this._skipIntercept = false
      }

      this._meta = {
        method,
        url: url.toString(),
        headers: {},
        async,
      }
      this._openUsername = username
      this._openPassword = password
    }

    setRequestHeader(name: string, value: string) {
      this._meta.headers[name] = value
    }

    /**
     * send 仅做分流：
     *   - 场景 1：同步请求 → `_sendWithoutIntercept`
     *   - 场景 2 / 3：异步请求 → `_sendWithIntercept`
     */
    send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (this._skipIntercept) {
        return this._sendWithoutIntercept(body)
      }
      void this._sendWithIntercept(body)
    }

    abort() {
      return this._xhr.abort()
    }

    getAllResponseHeaders(): string {
      if (this._overriddenHeaders !== undefined) return this._overriddenHeaders
      return this._xhr.getAllResponseHeaders()
    }

    getResponseHeader(name: string): string | null {
      if (this._overriddenHeaders !== undefined) {
        const lines = this._overriddenHeaders.split('\r\n')
        for (const line of lines) {
          const colonIndex = line.indexOf(': ')
          if (colonIndex === -1) continue
          const key = line.substring(0, colonIndex)
          const value = line.substring(colonIndex + 2)
          if (key && key.toLowerCase() === name.toLowerCase()) return value
        }
        return null
      }
      return this._xhr.getResponseHeader(name)
    }

    overrideMimeType(mime: string) {
      return this._xhr.overrideMimeType(mime)
    }

    // ==================== send 的三种场景实现 ====================

    /**
     * 场景 1：不拦截（同步请求），直接透传到原生 xhr。
     */
    private _sendWithoutIntercept(
      body?: Document | XMLHttpRequestBodyInit | null,
    ): void {
      const xhr = this._xhr
      const meta = this._meta

      xhr.open(meta.method, meta.url, meta.async, this._openUsername, this._openPassword)
      xhr.timeout = this._timeout
      xhr.withCredentials = this._withCredentials
      xhr.responseType = this._responseType
      Object.keys(meta.headers).forEach((name) => {
        xhr.setRequestHeader(name, meta.headers[name])
      })
      return xhr.send(body)
    }

    /**
     * 场景 2 / 3 入口：先跑请求拦截器，再根据是否命中 mock 分流。
     */
    private async _sendWithIntercept(
      body?: Document | XMLHttpRequestBodyInit | null,
    ): Promise<void> {
      const meta = this._meta

      const requestInit: RequestInit = {
        method: meta.method,
        headers: meta.headers,
      }
      // GET / HEAD 不允许 body，按 HTTP 语义忽略（与原生 XHR 行为一致）
      if (
        body !== undefined &&
        body !== null &&
        methodAllowsBody(meta.method)
      ) {
        requestInit.body = body as BodyInit
      }

      const baseRequest = new Request(meta.url, requestInit)
      const request: InterceptorRequest = {
        request: baseRequest,
        mockedResponse: null,
      }

      try {
        await runRequestInterceptors(request)

        // 拦截器已处理完毕，取最终请求
        const finalRequest = request.request

        // 场景 2：拦截器命中 mock
        if (request.mockedResponse) {
          this._mockActive = true
          await this._sendWithMockResponse(request.mockedResponse, finalRequest)
          return
        }

        // 场景 3：未命中 mock，发送真实请求
        await this._sendRealRequest(finalRequest)
      } catch (error) {
        console.error('[hookNetwork] XHR intercept error:', error)
      }
    }

    /**
     * 场景 2：使用模拟响应。
     * 响应体按 responseType（并结合 content-type）变形，与真实请求路径行为一致。
     */
    private async _sendWithMockResponse(
      mockedResponse: Response,
      finalRequest: Request,
    ): Promise<void> {
      const xhr = this._xhr
      const self = this

      // ---- 1) 跑响应拦截器 ----
      const responseContext: InterceptorResponse = {
        response: mockedResponse,
        request: finalRequest,
        setResponse(newResponse: Response) {
          this.response = newResponse
        },
      }
      await runResponseInterceptors(responseContext)
      const finalResponse = responseContext.response

      // ---- 2) 写 status / headers ----
      const headers: string[] = []
      finalResponse.headers.forEach((value, key) => {
        headers.push(`${key}: ${value}`)
      })
      this._overriddenHeaders = headers.join('\r\n')

      Object.defineProperty(xhr, 'readyState', { value: 2, writable: true, configurable: true })
      Object.defineProperty(xhr, 'status', {
        value: finalResponse.status,
        writable: true,
        configurable: true,
      })
      Object.defineProperty(xhr, 'statusText', {
        value: finalResponse.statusText,
        writable: true,
        configurable: true,
      })

      // ---- 3) 按 responseType + content-type 写入响应体 ----
      await this._applyResponseBody(xhr, finalResponse)

      // ---- 4) 分发事件 ----
      const triggerEvent = (type: ProxiedEventType) => {
        const event = new Event(type)
        self._dispatchHookedEvent(type, event)
      }

      triggerEvent('readystatechange')
      triggerEvent('loadstart')

      Object.defineProperty(xhr, 'readyState', { value: 3, writable: true, configurable: true })
      triggerEvent('readystatechange')
      triggerEvent('progress')

      Object.defineProperty(xhr, 'readyState', { value: 4, writable: true, configurable: true })
      triggerEvent('readystatechange')
      triggerEvent('load')
      triggerEvent('loadend')
    }

    /**
     * 场景 3：发送真实请求。
     * 从拦截器处理后的最终 Request 中提取 method / url / headers / body。
     */
    private async _sendRealRequest(finalRequest: Request): Promise<void> {
      const xhr = this._xhr

      const method = finalRequest.method
      const url = finalRequest.url

      const headers: Record<string, string> = {}
      finalRequest.headers.forEach((value, key) => {
        headers[key] = value
      })

      let sendBody: BodyInit | null = null
      if (methodAllowsBody(method)) {
        const buffer = await finalRequest.clone().arrayBuffer()
        if (buffer.byteLength > 0) {
          sendBody = buffer
        }
      }

      xhr.open(method, url, true, this._openUsername, this._openPassword)
      xhr.timeout = this._timeout
      xhr.withCredentials = this._withCredentials
      xhr.responseType = this._responseType

      Object.keys(headers).forEach((name) => {
        xhr.setRequestHeader(name, headers[name])
      })

      this._baseRequest = finalRequest
      this._responseInterceptorsRan = false

      xhr.send(sendBody)
    }
  }

  Object.defineProperty(HookedXMLHttpRequest, 'name', {
    value: 'XMLHttpRequest',
    configurable: true,
  })

  Object.defineProperty(window, 'XMLHttpRequest', {
    value: HookedXMLHttpRequest,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

// ==================== fetch 拦截 ====================

function patchFetch() {
  if (typeof window.fetch !== 'function') return

  const originalFetch = window.fetch

  /**
   * Hooked fetch：
   *   1) 用 `new Request(input, init)` 统一构建 Request；
   *   2) 跑请求拦截器，允许改写 method / url / headers / body 或直接 respondWith；
   *   3) 命中 mock：跑响应拦截器后直接返回最终 Response；
   *      未命中：调用原生 fetch 得到真实响应，跑响应拦截器后返回最终 Response；
   *   4) 任一步骤抛错 → 跑错误拦截器，再向上抛出（保持 fetch reject 语义）。
   */
  const hookedFetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // 用户如果对 GET / HEAD 传了 body，这里先剔除，避免 new Request 直接抛错，
    // 与原生 XHR 忽略 body 的行为保持一致。
    let normalizedInit = init
    if (init) {
      const method = init.method || (input instanceof Request ? input.method : 'GET')
      if (!methodAllowsBody(method) && init.body !== undefined && init.body !== null) {
        const { body: _ignored, ...rest } = init
        normalizedInit = rest
      }
    }

    const baseRequest = new Request(input, normalizedInit)
    const request: InterceptorRequest = {
      request: baseRequest,
      mockedResponse: null,
    }

    try {
      await runRequestInterceptors(request)

      const finalRequest = request.request

      // ---- 场景 2：命中 mock ----
      if (request.mockedResponse) {
        const responseContext: InterceptorResponse = {
          response: request.mockedResponse,
          request: finalRequest,
          setResponse(newResponse: Response) {
            this.response = newResponse
          },
        }
        await runResponseInterceptors(responseContext)
        return responseContext.response
      }

      // ---- 场景 3：真实请求 ----
      const realResponse = await originalFetch.call(window, finalRequest)

      const responseContext: InterceptorResponse = {
        response: realResponse,
        request: finalRequest,
        setResponse(newResponse: Response) {
          this.response = newResponse
        },
      }
      await runResponseInterceptors(responseContext)
      return responseContext.response
    } catch (error) {
      await runErrorInterceptors(error as Error, request.request)
      throw error
    }
  } as typeof window.fetch

  Object.defineProperty(hookedFetch, 'name', {
    value: 'fetch',
    configurable: true,
  })

  Object.defineProperty(window, 'fetch', {
    value: hookedFetch,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

// ==================== 初始化 ====================

export function installXhrAndFetchHook() {
  if (isInitialized) return
  isInitialized = true
  patchXHR()
  patchFetch()
}