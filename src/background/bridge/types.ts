import type {
  PromiseResult as _PromiseResult,
  BridgeRequest as _BridgeRequest,
  BridgeResponse as _BridgeResponse,
  BridgeHandler as _BridgeHandler,
} from '@/shared/bridge/types';

export type PromiseResult = _PromiseResult;
export type BridgeRequest = _BridgeRequest;
export type BridgeResponse = _BridgeResponse;
export type BridgeHandler = _BridgeHandler;

/**
 * 后台 Action 处理器签名。
 * 与页面侧 {@link BridgeHandler} 不同，这里不接收 action 名，
 * 但额外接收 sender 以便定位调用来源。
 */
export type BackgroundActionHandler = (
  args: unknown[] | undefined,
  sender: chrome.runtime.MessageSender,
) => unknown | Promise<unknown>;

/** 进行中的后台 → 页面 调用，按 actionId 配对响应 */
export interface PendingBackgroundAction {
  action: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** 注入页面 MAIN world 的事件载荷（请求 / 响应通用结构） */
export interface InjectedBridgePayload {
  actionId: string;
  action: string;
  args?: unknown[];
  result?: unknown;
  promiseResult?: PromiseResult;
}

/** 后台 → 页面 调用的发起选项 */
export interface DispatchBackgroundActionOptions {
  /** 目标 tab id（必填，缺失时将以 reject 失败） */
  tabId?: number;
  /** 目标 iframe 的 frameId；> 0 时仅注入该 frame */
  frameId?: number;
  /** 超时时间（ms），默认 30s */
  timeout?: number;
}
