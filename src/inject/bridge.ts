import { PAGE_REQUEST_EVENT, BACKGROUND_RESPONSE_EVENT } from '@/constants/events';
import type { BridgeRequest, BridgeResponse } from '@/utils/Bridge/types';

export interface InjectBridgeConfig {
  target?: EventTarget;
}

export class InjectBridge {
  private readonly target: EventTarget;
  private destroyed = false;

  private readonly forwardPageRequest = (e: Event) => {
    if (this.destroyed) return;
    const detail = (e as CustomEvent<BridgeRequest>).detail;
    if (!detail || typeof detail !== 'object') return;

    void chrome.runtime.sendMessage(detail).catch(() => {});
  };

  private readonly forwardBackgroundResponse = (e: Event) => {
    if (this.destroyed) return;
    const detail = (e as CustomEvent<BridgeResponse>).detail;
    if (!detail || typeof detail !== 'object') return;

    void chrome.runtime.sendMessage(detail).catch(() => {});
  };

  constructor(config: InjectBridgeConfig = {}) {
    this.target = config.target ?? window;
    this.target.addEventListener(PAGE_REQUEST_EVENT, this.forwardPageRequest as EventListener, false);
    this.target.addEventListener(BACKGROUND_RESPONSE_EVENT, this.forwardBackgroundResponse as EventListener, false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.target.removeEventListener(PAGE_REQUEST_EVENT, this.forwardPageRequest as EventListener, false);
    this.target.removeEventListener(BACKGROUND_RESPONSE_EVENT, this.forwardBackgroundResponse as EventListener, false);
  }
}

export default function installInjectBridge(): InjectBridge {
  return new InjectBridge();
}
