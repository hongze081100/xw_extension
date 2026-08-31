import { generateActionId } from '@/utils/helper';
import type {
  BackgroundBridgeHandler,
  BridgeRequest,
  BridgeResponse,
  DispatchBackgroundActionOptions,
  InjectedBridgePayload,
  PendingAction,
  PromiseResult,
} from './types';

import {
  PAGE_ACTION_RESPONSE_EVENT,
  BACKGROUND_ACTION_REQUEST_EVENT,
  DEFAULT_ACTION_TIMEOUT,
} from './constants';

/** 后台 Action 处理器注册表，按 action 名分发 */
const backgroundBridgeHandlers = new Map<string, BackgroundBridgeHandler>();

/** 进行中的后台 → 页面 调用，按 actionId 配对响应 */
const pendingActionMap = new Map<string, PendingAction>();

/**
 * 注册后台 Action 处理器。页面通过 page_action_request 调用时，
 * 将按 action 名查找并执行对应 handler。
 */
export function registerBackgroundBridgeHandler(
  action: string,
  handler: BackgroundBridgeHandler,
): void {
  backgroundBridgeHandlers.set(action, handler);
}


/**
 * 处理页面发起的请求：按 action 查找 handler 执行，
 * 并通过 chrome.scripting.executeScript 将结果以 page_action_response
 * 事件回执到发起方 tab/frame 的 MAIN world。
 */
export function handlePageActionRequest(
  request: BridgeRequest,
  sender: chrome.runtime.MessageSender,
): void {
  console.log('====handlePageActionRequest', request);
  const { action, actionId, args } = request;

  /** 将结果回执到页面 */
  const respond = (promiseResult: PromiseResult, result: unknown) => {
    const payload: InjectedBridgePayload = { actionId, action, result, promiseResult };
    dispatchEventToSender(sender, PAGE_ACTION_RESPONSE_EVENT, payload);
  };

  const handler = backgroundBridgeHandlers.get(action);
  if (!handler) {
    respond('reject', `未找到方法 ${action}`);
    return;
  }

  Promise.resolve()
    .then(() => handler(args, sender))
    .then((result) => respond('resolve', result))
    .catch((err: unknown) =>
      respond('reject', err instanceof Error ? err.message : String(err)),
    );
}

/**
 * 通过 chrome.scripting.executeScript 将事件派发到 sender 对应 tab/frame 的 MAIN world。
 * 注入的 func 在页面环境执行，所有数据必须通过 args 传入（无法访问闭包）。
 */
function dispatchEventToSender(
  sender: chrome.runtime.MessageSender,
  eventName: string,
  data: InjectedBridgePayload,
): void {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const target: chrome.scripting.InjectionTarget = { tabId };
  if ((sender.frameId ?? 0) > 0) {
    target.frameIds = [sender.frameId as number];
  }
  console.log('====dispatchEventToSender', target, eventName, data);
  chrome.scripting
    .executeScript({
      target,
      world: 'MAIN',
      func: (eventName: string, data: InjectedBridgePayload) => {
        console.log('====dispatchEventToSender', eventName, data);
        window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
      },
      args: [eventName, data],
    })
    .catch((e) => {
      console.error('====dispatchEventToSender error', e);
    });
}

/**
 * 从后台向页面发起调用：将 background_action_request 事件注入到目标 tab/frame 的 MAIN world，
 * 等待页面以 background_action_response 回执（经 inject 转发回 background）。
 *
 * @param action  要调用的方法名
 * @param args    调用参数（可省略）
 * @param options 目标 tab/frame 与超时配置；tabId 为必填
 */
export function dispatchBackgroundActionRequest(
  action: string,
  args?: unknown[],
  options: DispatchBackgroundActionOptions = {},
): Promise<unknown> {
  const { tabId, frameId, timeout = DEFAULT_ACTION_TIMEOUT } = options;
  if (tabId == null) {
    return Promise.reject(new Error(`${action} 缺少目标 tabId`));
  }

  const target: chrome.scripting.InjectionTarget = { tabId };
  if (frameId != null && frameId > 0) {
    target.frameIds = [frameId];
  }

  const actionId = generateActionId();
  const request: BridgeRequest = { actionId, action, args };

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingActionMap.delete(actionId);
      reject(new Error(`${action} 调用超时`));
    }, timeout);

    pendingActionMap.set(actionId, { action, resolve, reject, timeoutId });

    chrome.scripting
      .executeScript({
        target,
        world: 'MAIN',
        func: (eventName: string, data: BridgeRequest) => {
          window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
        },
        args: [BACKGROUND_ACTION_REQUEST_EVENT, request],
      })
      .catch((err: unknown) => {
        pendingActionMap.delete(actionId);
        clearTimeout(timeoutId);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/**
 * 处理页面返回的响应：按 actionId 找到 pending 并结算。
 */
export function handleBackgroundActionResponse(response: BridgeResponse): void {
  const { actionId, result, promiseResult } = response;
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
