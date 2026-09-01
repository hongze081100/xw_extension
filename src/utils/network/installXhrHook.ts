import { headersToObject } from "./helper";
import { runInterceptors } from "./interceptor";
import { FetchContext } from "./types";

const nativeFetch = window.fetch;
const NativeHeaders = window.Headers;
const NativeRequest = window.Request;
const NativeResponse = window.Response;

/** 全局 XMLHttpRequest 替换 */
export default function installXHRHook(): void {
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