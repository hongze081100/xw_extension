import { FetchContext, FetchInterceptor } from "./types";

const fetchInterceptors: FetchInterceptor[] = [];

export function addFetchInterceptor(interceptor: FetchInterceptor): void {
  fetchInterceptors.push(interceptor);
}

export function runInterceptors(context: FetchContext): void {
  for (const interceptor of fetchInterceptors) {
    if (context.disabled) break;
    interceptor(context);
  }
}