export type BridgeSource = 'page' | 'content' | 'background';

export type PromiseResult = 'resolve' | 'reject';

export interface BridgeRequest {
  source: BridgeSource;
  action: string;
  actionId: string;
  args?: unknown[];
}

export interface BridgeResponse {
  actionId: string;
  action: string;
  result: unknown;
  promiseResult: PromiseResult;
}

export type BridgeHandler = (action: string, args?: unknown[]) => Promise<unknown>;
