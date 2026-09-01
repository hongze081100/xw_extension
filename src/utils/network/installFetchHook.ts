import { FetchRequest } from "../network-hook";
import { cloneResponse, headersToObject, normalizeUrl } from "./helper";
import { runInterceptors } from "./interceptor";
import { FetchContext } from "./types";

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

/** 全局 fetch 替换 */
export default function installFetchHook(): void {
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
