const nativeFetch = window.fetch;
const NativeHeaders = window.Headers;
const NativeRequest = window.Request;
const NativeResponse = window.Response;

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
