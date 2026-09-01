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