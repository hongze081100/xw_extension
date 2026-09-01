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

import installFetchHook from "./installFetchHook";
import { addFetchInterceptor } from "./interceptor";
import { FetchInterceptor } from "./types";

let hooksInstalled = false;

/** 注册 Fetch 拦截器 */
export function addFetchListener(interceptor: FetchInterceptor): void {
  ensureHooksInstalled();
  addFetchInterceptor(interceptor);
}

export function ensureHooksInstalled(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  installFetchHook();
  // installXHRHook();
}



