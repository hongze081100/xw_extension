import { generateActionId } from '@/utils/helper';
import { 
  BridgeHandler, 
  BridgeRequest,
  BridgeResponse,
  PendingPageAction,
  PromiseResult,
} from './types';
import {
  BACKGROUND_ACTION_REQUEST_EVENT,
  BACKGROUND_ACTION_RESPONSE_EVENT,
  DEFAULT_ACTION_TIMEOUT,
  PAGE_ACTION_REQUEST_EVENT,
  PAGE_ACTION_RESPONSE_EVENT
} from './constants';


const pendingActionMap = new Map<string, PendingPageAction>();

/**
 * 从页面发起一次后台调用：派发 page_action_request 事件（由 inject 转发给 background），
 * 返回 Promise，在收到响应或超时后结算。
 *
 * @param action  要调用的方法名
 * @param args    调用参数
 * @param timeout 超时时间（ms），默认 30s
 */
export function dispatchPageActionRequest(
  action: string,
  args?: unknown[],
  timeout: number = DEFAULT_ACTION_TIMEOUT,
): Promise<unknown> {
  const actionId = generateActionId();
  const request: BridgeRequest = { actionId, action, args };
  window.dispatchEvent(
    new CustomEvent(PAGE_ACTION_REQUEST_EVENT, { detail: request }),
  );
  console.log('====dispatchPageActionRequest', request);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingActionMap.delete(actionId);
      reject(new Error(`${action} 调用超时`));
    }, timeout);

    pendingActionMap.set(actionId, { resolve, reject, timeoutId });
  });
}

/**
 * 处理后台返回的响应：根据 actionId 找到对应的 pending promise 并结算。
 * 监听的事件为 page_action_response（后台 → 页面）。
 */
function handlePageActionResponse(e: Event): void {
  const detail = (e as CustomEvent<BridgeResponse>).detail;
  if (!detail || typeof detail !== 'object') return;

  const { actionId, result, promiseResult } = detail;
  if (!actionId) return;

  const pending = pendingActionMap.get(actionId);
  if (!pending) return;
  pendingActionMap.delete(actionId);
  clearTimeout(pending.timeoutId);

  if (promiseResult === 'resolve') {
    pending.resolve(result);
  } else {
    pending.reject(result);
  }
}

/** 后台 → 页面 请求的处理器注册表，按 action 名分发 */
const bridgeHandlers = new Map<string, BridgeHandler>();

/**
 * 处理后台发起的请求：按 action 查找 handler 执行，
 * 并以 background_action_response 事件回执结果（经 inject 转发给 background）。
 */
function handleBackgroundActionRequest(e: Event): void {
  const detail = (e as CustomEvent<BridgeRequest>).detail;
  if (!detail || typeof detail !== 'object') return;

  const { actionId, action, args } = detail;
  if (!actionId || !action) return;

  const handler = bridgeHandlers.get(action);

  /** 将结果以事件形式回执给后台 */
  const reply = (promiseResult: PromiseResult, result: unknown) => {
    const response: BridgeResponse = { actionId, action, result, promiseResult };
    window.dispatchEvent(
      new CustomEvent(BACKGROUND_ACTION_RESPONSE_EVENT, { detail: response }),
    );
  };

  if (!handler) {
    reply('reject', `未找到方法 ${action}`);
    return;
  }

  Promise.resolve()
    .then(() => handler(action, args))
    .then((result) => reply('resolve', result))
    .catch((err: unknown) =>
      reply('reject', err instanceof Error ? err.message : String(err)),
    );
}

/**
 * 注册后台 → 页面 请求的处理器。
 */
export function registerPageBrigdeHandler(
  action: string,
  handler: BridgeHandler,
): void {
  bridgeHandlers.set(action, handler);
}

/**
 * 安装页面侧桥接：监听后台响应（page_action_response）与后台请求（background_action_request）。
 *
 * @returns 卸载函数，调用以移除监听
 */
export function installBridge(): () => void {
  window.addEventListener(PAGE_ACTION_RESPONSE_EVENT, handlePageActionResponse);
  window.addEventListener(BACKGROUND_ACTION_REQUEST_EVENT, handleBackgroundActionRequest);
  return () => {
    window.removeEventListener(PAGE_ACTION_RESPONSE_EVENT, handlePageActionResponse);
    window.removeEventListener(BACKGROUND_ACTION_REQUEST_EVENT, handleBackgroundActionRequest);
  };
}
