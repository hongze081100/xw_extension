/** 一次跨上下文调用的最终状态：resolve 成功 / reject 失败 */
export type PromiseResult = 'resolve' | 'reject';

/** 桥接请求载荷 */
export interface BridgeRequest {
  /** 全局唯一的请求 ID，用于将响应与请求配对 */
  actionId: string;
  /** 要调用的方法名 */
  action: string;
  /** 调用参数列表 */
  args?: unknown[];
}

/** 桥接响应载荷，是对 BridgeRequest 的回执 */
export interface BridgeResponse {
  /** 与对应请求一致的 actionId */
  actionId: string;
  /** 回执对应的方法名 */
  action: string;
  /** 调用结果：成功时为返回值，失败时为错误信息 */
  result: unknown;
  /** 标识本回执是 resolve 还是 reject */
  promiseResult: PromiseResult;
}

/** 通用桥接方法处理器签名（页面侧按 action 名分发） */
export type BridgeHandler = (
  action: string,
  args?: unknown[],
) => unknown | Promise<unknown>;
