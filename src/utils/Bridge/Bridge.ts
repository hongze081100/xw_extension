import type {
  BridgeRequest,
  BridgeResponse,
  BridgeHandler,
  BridgeSource,
  PromiseResult,
} from './types';
import { generateActionId } from '@/utils/helper';

export type BridgeMode = 'sender' | 'receiver' | 'both';

export interface BridgeConfig {
  requestEvent: string;
  responseEvent: string;
  source: BridgeSource;
  mode?: BridgeMode;
  defaultTimeout?: number;
  target?: EventTarget;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT = 30_000;

export class Bridge {
  private readonly target: EventTarget;
  private readonly requestEvent: string;
  private readonly responseEvent: string;
  private readonly source: BridgeSource;
  private readonly mode: BridgeMode;
  private readonly defaultTimeout: number;

  private readonly handlerMap = new Map<string, BridgeHandler>();
  private readonly pendingMap = new Map<string, PendingRequest>();

  private destroyed = false;

  private readonly onRequest = (e: Event) => {
    const detail = (e as CustomEvent<BridgeRequest>).detail;
    if (!detail || typeof detail !== 'object') return;

    const { actionId, action, args } = detail;
    if (!actionId || !action) return;

    const handler = this.handlerMap.get(action);

    const reply = (promiseResult: PromiseResult, result: unknown) => {
      if (this.destroyed) return;
      const response: BridgeResponse = { actionId, action, result, promiseResult };
      this.target.dispatchEvent(new CustomEvent(this.responseEvent, { detail: response }));
    };

    if (!handler) {
      reply('reject', `未找到方法 ${action}`);
      return;
    }

    Promise.resolve()
      .then(() => handler(action, args))
      .then((result) => reply('resolve', result))
      .catch((err) => reply('reject', err instanceof Error ? err.message : String(err)));
  };

  private readonly onResponse = (e: Event) => {
    const detail = (e as CustomEvent<BridgeResponse>).detail;
    if (!detail || typeof detail !== 'object') return;

    const { actionId, result, promiseResult } = detail;
    if (!actionId) return;

    const pending = this.pendingMap.get(actionId);
    if (!pending) return;

    this.pendingMap.delete(actionId);
    clearTimeout(pending.timeoutId);

    if (promiseResult === 'resolve') {
      pending.resolve(result);
    } else {
      pending.reject(result);
    }
  };

  constructor(config: BridgeConfig) {
    this.target = config.target ?? window;
    this.requestEvent = config.requestEvent;
    this.responseEvent = config.responseEvent;
    this.source = config.source;
    this.mode = config.mode ?? 'both';
    this.defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;

    if (this.mode !== 'sender') {
      this.target.addEventListener(this.requestEvent, this.onRequest as EventListener, false);
    }
    if (this.mode !== 'receiver') {
      this.target.addEventListener(this.responseEvent, this.onResponse as EventListener, false);
    }
  }

  send(action: string, args?: unknown[], timeout?: number): Promise<unknown> {
    if (this.destroyed) {
      return Promise.reject(new Error('Bridge 已销毁'));
    }
    if (this.mode === 'receiver') {
      return Promise.reject(new Error('当前 Bridge 为接收模式，不支持 send'));
    }

    const actionId = generateActionId();
    const request: BridgeRequest = { source: this.source, actionId, action, args };

    this.target.dispatchEvent(new CustomEvent(this.requestEvent, { detail: request }));

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingMap.delete(actionId);
        reject(new Error(`${action} 调用超时`));
      }, timeout ?? this.defaultTimeout);

      this.pendingMap.set(actionId, { resolve, reject, timeoutId });
    });
  }

  register(action: string, handler: BridgeHandler): void {
    if (this.destroyed) return;
    if (this.mode === 'sender') {
      throw new Error('当前 Bridge 为发送模式，不支持 register');
    }
    this.handlerMap.set(action, handler);
  }

  unregister(action: string): void {
    this.handlerMap.delete(action);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.mode !== 'sender') {
      this.target.removeEventListener(this.requestEvent, this.onRequest as EventListener, false);
    }
    if (this.mode !== 'receiver') {
      this.target.removeEventListener(this.responseEvent, this.onResponse as EventListener, false);
    }

    this.pendingMap.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Bridge 已销毁'));
    });
    this.pendingMap.clear();
    this.handlerMap.clear();
  }
}
