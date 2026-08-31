export type {
  PromiseResult,
  BridgeRequest,
  BridgeResponse,
  BridgeHandler,
} from '@/shared/bridge/types';

/** 页面侧内部使用：进行中的页面 → 后台 调用，按 actionId 配对响应 */
export interface PendingPageAction {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}
