import { ListenerRecord } from "./types";

/**
 * 类型安全的 EventEmitter（事件发射器）
 * @template T 事件映射表，Key 为事件名，Value 为监听函数的参数类型元组
 */
class EventEmitter<T extends Record<string, any[]>> {
  // 内部使用 Map 存储事件名到监听器记录数组的映射，查找和更新的时间复杂度为 O(1)
  private listenerRecordsMap = new Map<keyof T, ListenerRecord<any>[]>();

  /**
   * 注册事件监听器
   * @param eventName 事件名称
   * @param listener 监听函数
   * @param once 是否为一次性监听（触发后自动移除）
   */
  on<K extends keyof T>(eventName: K, listener: (...args: T[K]) => void, once = false): this {
    if (!this.listenerRecordsMap.has(eventName)) {
      this.listenerRecordsMap.set(eventName, []);
    }
    
    const listenerRecords = this.listenerRecordsMap.get(eventName)!;
    listenerRecords.push({ listener, once });
    
    return this; // 支持链式调用
  }

  /**
   * 注册一次性事件监听器
   * @param eventName 事件名称
   * @param listener 监听函数
   */
  once<K extends keyof T>(eventName: K, listener: (...args: T[K]) => void): this {
    return this.on(eventName, listener, true);
  }

  /**
   * 移除事件监听器
   * @param eventName 事件名称
   * @param listener 需要移除的监听函数引用
   */
  off<K extends keyof T>(eventName: K, listener: (...args: T[K]) => void): this {
    const listenerRecords = this.listenerRecordsMap.get(eventName);
    if (!listenerRecords) return this;

    // 过滤掉与传入引用相同的监听器
    const remainingListenerRecords = listenerRecords.filter(
      (item) => item.listener !== listener
    );
    this.listenerRecordsMap.set(eventName, remainingListenerRecords);
    
    return this;
  }

  /**
   * 触发事件
   * @param eventName 事件名称
   * @param args 传递给监听函数的参数
   */
  emit<K extends keyof T>(eventName: K, ...args: T[K]): this {
    const listenerRecords = this.listenerRecordsMap.get(eventName);
    if (!listenerRecords) return this;

    // 构建新数组以保留持久化监听器，避免在遍历中直接修改数组导致索引错乱
    const remainingListenerRecords: ListenerRecord<any>[] = [];

    for (const item of listenerRecords) {
      try {
        // 执行监听函数并透传参数
        item.listener(...args);
      } catch (err) {
        // 异常隔离：防止单个监听器报错导致后续监听器无法执行
        console.error(`Error in listener for event "${String(eventName)}":`, err);
      }

      // 非一次性监听器保留到新数组中
      if (!item.once) {
        remainingListenerRecords.push(item);
      }
    }

    this.listenerRecordsMap.set(eventName, remainingListenerRecords);
    return this;
  }
}

export default EventEmitter;