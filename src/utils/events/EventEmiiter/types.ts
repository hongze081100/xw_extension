/**
 * 监听器记录接口
 * 用于在内部 Map 中统一管理监听函数及其元数据
 */
export interface ListenerRecord<T extends any[]> {
  listener: (...args: T) => void; // 具体的监听函数
  once: boolean;                  // 是否为一次性监听
}
