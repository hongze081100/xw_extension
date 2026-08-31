/**
 * 页面 MAIN world 上的 CustomEvent 名，以及 inject / background 间 chrome.runtime 消息类型：
 * 页面 → 后台 发起调用（页面派发 window 事件 → inject 监听 → 以相同值作为 runtime 消息转发给 background）。
 */
export const PAGE_ACTION_REQUEST_EVENT = 'page_action_request';

/** 页面 MAIN world 上的 CustomEvent 名：后台 → 页面 回执调用（后台通过 executeScript 派发到页面 MAIN world） */
export const PAGE_ACTION_RESPONSE_EVENT = 'page_action_response';

/** 页面 MAIN world 上的 CustomEvent 名：后台 → 页面 发起调用（后台通过 executeScript 派发到页面 MAIN world） */
export const BACKGROUND_ACTION_REQUEST_EVENT = 'background_action_request';

/**
 * 页面 MAIN world 上的 CustomEvent 名，以及 inject / background 间 chrome.runtime 消息类型：
 * 页面 → 后台 回执调用（页面派发 window 事件 → inject 监听 → 以相同值作为 runtime 消息转发给 background）。
 */
export const BACKGROUND_ACTION_RESPONSE_EVENT = 'background_action_response';

/** 默认调用超时时间（ms） */
export const DEFAULT_ACTION_TIMEOUT = 30_000;
