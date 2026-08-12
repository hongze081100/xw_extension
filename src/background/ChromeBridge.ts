import type { BridgeRequest, BridgeResponse, BridgeSource, PromiseResult } from '@/utils/Bridge/types';
import { generateActionId } from '@/utils/helper';

export interface BackgroundBridgeRequestContext {
  tabId: number;
  frameId: number;
  url?: string;
  origin?: string;
}

export type ChromeBridgeHandler = (
  args: unknown[] | undefined,
  context: BackgroundBridgeRequestContext
) => Promise<unknown> | unknown;

export interface ChromeBridgeConfig {
  source: BridgeSource;
  requestEvent: string;
  responseEvent: string;
  defaultTimeout?: number;
}

interface PendingSend {
  action: string;
  resolve: (result: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export class ChromeBridge {
  private readonly source: BridgeSource;
  private readonly requestEvent: string;
  private readonly responseEvent: string;
  private readonly defaultTimeout: number;

  private readonly handlerMap = new Map<string, ChromeBridgeHandler>();
  private readonly pendingMap = new Map<string, PendingSend>();

  private destroyed = false;

  private readonly onMessage = (
    request: BridgeRequest | BridgeResponse,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (this.destroyed) return false;

    const pending = 'actionId' in request && 'promiseResult' in request
      ? this.pendingMap.get(request.actionId)
      : undefined;

    if (pending) {
      this.pendingMap.delete(request.actionId);
      clearTimeout(pending.timeoutId);
      const res = request as BridgeResponse;
      if (res.promiseResult === 'resolve') {
        pending.resolve(res.result);
      } else {
        pending.reject(res.result);
      }
      sendResponse({});
      return true;
    }

    if (!('source' in request) || request.source !== this.source) return false;

    this.handleRequest(request as BridgeRequest, sender);
    sendResponse({});
    return true;
  };

  constructor(config: ChromeBridgeConfig) {
    this.source = config.source;
    this.requestEvent = config.requestEvent;
    this.responseEvent = config.responseEvent;
    this.defaultTimeout = config.defaultTimeout ?? 30_000;
    chrome.runtime.onMessage.addListener(this.onMessage);
  }

  register(action: string, handler: ChromeBridgeHandler): void {
    this.handlerMap.set(action, handler);
  }

  unregister(action: string): void {
    this.handlerMap.delete(action);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.pendingMap.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('ChromeBridge 已销毁'));
    });
    this.pendingMap.clear();
    this.handlerMap.clear();
    chrome.runtime.onMessage.removeListener(this.onMessage);
  }

  send(
    action: string,
    args?: unknown[],
    options?: { tabId?: number; frameId?: number; timeout?: number },
  ): Promise<unknown> {
    if (this.destroyed) {
      return Promise.reject(new Error('ChromeBridge 已销毁'));
    }

    const actionId = generateActionId();
    const request: BridgeRequest = { source: this.source, actionId, action, args };
    const target = this.resolveTarget(options?.tabId, options?.frameId);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingMap.delete(actionId);
        reject(new Error(`${action} 调用超时`));
      }, options?.timeout ?? this.defaultTimeout);

      this.pendingMap.set(actionId, { action, resolve, reject, timeoutId });

      chrome.scripting
        .executeScript({
          target,
          world: 'MAIN',
          func: (eventName: string, data: BridgeRequest) => {
            window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
          },
          args: [this.requestEvent, request],
        })
        .catch((err) => {
          this.pendingMap.delete(actionId);
          clearTimeout(timeoutId);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  broadcast(action: string, args?: unknown[]): Promise<unknown[]> {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const tabIds = tabs
          .filter((t) => t.id != null && t.url && !t.url.startsWith('chrome://'))
          .map((t) => t.id!);

        const results = tabIds.map((tabId) =>
          this.send(action, args, { tabId }).catch((err) => err),
        );
        resolve(Promise.all(results));
      });
    });
  }

  private resolveTarget(tabId?: number, frameId?: number): chrome.scripting.InjectionTarget {
    if (tabId != null) {
      const target: chrome.scripting.InjectionTarget = { tabId };
      if (frameId != null && frameId > 0) {
        target.frameIds = [frameId];
      }
      return target;
    }
    return { allFrames: true } as unknown as chrome.scripting.InjectionTarget;
  }

  private handleRequest(request: BridgeRequest, sender: chrome.runtime.MessageSender): void {
    const { action, actionId, args } = request;
    const tabId = sender.tab?.id ?? 0;
    const frameId = sender.frameId ?? 0;

    const context: BackgroundBridgeRequestContext = {
      tabId,
      frameId,
      url: sender.url,
      origin: sender.origin ?? '',
    };

    const reply = (promiseResult: PromiseResult, result: unknown) => {
      if (this.destroyed) return;
      this.dispatchResponse(sender, { actionId, action, result, promiseResult });
    };

    const handler = this.handlerMap.get(action);
    if (!handler) {
      reply('reject', `未找到方法 ${action}`);
      return;
    }

    Promise.resolve()
      .then(() => handler(args, context))
      .then((result) => reply('resolve', result))
      .catch((err) => reply('reject', err instanceof Error ? err.message : String(err)));
  }

  private dispatchResponse(
    sender: chrome.runtime.MessageSender,
    payload: BridgeResponse,
  ): void {
    const tabId = sender.tab?.id;
    if (tabId == null) return;

    const target: chrome.scripting.InjectionTarget = { tabId };
    if ((sender.frameId ?? 0) > 0) {
      target.frameIds = [sender.frameId!];
    }

    chrome.scripting
      .executeScript({
        target,
        world: 'MAIN',
        func: (eventName: string, data: BridgeResponse) => {
          window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
        },
        args: [this.responseEvent, payload],
      })
      .catch(() => {});
  }
}
