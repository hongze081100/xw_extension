import { PAGE_ACTION_REQUEST_EVENT, BACKGROUND_ACTION_RESPONSE_EVENT } from "./constants";
import type { BridgeRequest, BridgeResponse } from "./types";


/** InjectBridge 初始化配置 */
export interface InjectBridgeConfig {
  /** 监听事件的目标，默认为 window */
  target?: EventTarget;
}

/**
 * Inject 桥接器：作为 content script（隔离世界）与页面 MAIN world、
 * 以及 background service worker 之间的中转。
 *
 * 职责：把页面在 window 上派发的 CustomEvent 转发到 background（chrome.runtime.sendMessage），
 * 不处理任何业务逻辑。支持通过 destroy() 幂等卸载。
 */
export class InjectBridge {
  private readonly target: EventTarget;
  private destroyed = false;

  /**
   * 转发页面 → 后台的请求：监听 page_action_request 事件，
   * 将其作为 chrome.runtime 消息发送给 background。
   */
  private readonly forwardPageRequest = (e: Event) => {
    if (this.destroyed) return;
    const detail = (e as CustomEvent<BridgeRequest>).detail;
    if (!detail || typeof detail !== 'object') return;

    void chrome.runtime
      .sendMessage({ ...detail, type: PAGE_ACTION_REQUEST_EVENT })
      .catch(() => {});
  };

  /**
   * 转发页面 → 后台的响应：监听 background_action_response 事件，
   * 将其作为 chrome.runtime 消息发送给 background（用于结算后台发起的 pending 调用）。
   */
  private readonly forwardBackgroundResponse = (e: Event) => {
    if (this.destroyed) return;
    const detail = (e as CustomEvent<BridgeResponse>).detail;
    if (!detail || typeof detail !== 'object') return;

    void chrome.runtime
      .sendMessage({ ...detail, type: BACKGROUND_ACTION_RESPONSE_EVENT })
      .catch(() => {});
  };

  constructor(config: InjectBridgeConfig = {}) {
    this.target = config.target ?? window;
    this.target.addEventListener(
      PAGE_ACTION_REQUEST_EVENT,
      this.forwardPageRequest as EventListener,
      false,
    );
    this.target.addEventListener(
      BACKGROUND_ACTION_RESPONSE_EVENT,
      this.forwardBackgroundResponse as EventListener,
      false,
    );
  }

  /** 幂等地卸载桥接：移除所有事件监听，后续事件不再转发 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.target.removeEventListener(
      PAGE_ACTION_REQUEST_EVENT,
      this.forwardPageRequest as EventListener,
      false,
    );
    this.target.removeEventListener(
      BACKGROUND_ACTION_RESPONSE_EVENT,
      this.forwardBackgroundResponse as EventListener,
      false,
    );
  }
}

/** 创建并安装一个 InjectBridge 实例，返回实例以便后续调用 destroy() */
export default function installInjectBridge(): InjectBridge {
  return new InjectBridge();
}
