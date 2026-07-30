/**
 * 资源生命周期钩子定义（极简同步版）
 */
interface ResourceLifecycle<TData, TInstance> {
  // 纯同步创建
  onCreate: (data: TData) => TInstance;
  // 可选的同步更新
  onUpdate?: (instance: TInstance, newData: TData) => void;
  // 纯同步销毁（移除了 isShadow 参数）
  onDestroy: (instance: TInstance) => void;
}

/**
 * 资源管理器配置项
 */
interface ResourceManagerOptions<TData> {
  // 自定义哈希函数
  hashFn?: (data: TData) => string | number;
  // 指定数据中的 ID 字段
  idKey?: keyof TData;
}

/**
 * 内部维护的资源状态记录
 */
interface ResourceRecord<TInstance> {
  instance: TInstance;
  references: number;
}

/**
 * 创建资源管理器工厂函数（极简同步版 - 无事件通知、无影子实例）
 */
export function createResourceManager<TData, TInstance>(
  lifecycle: ResourceLifecycle<TData, TInstance>,
  options: ResourceManagerOptions<TData> = {}
) {
  const { idKey, hashFn } = options;

  const activeResources = new Map<string | number, ResourceRecord<TInstance>>();
  let lastResourceIds: (string | number)[] = [];

  // ========== 1. 多级 ID 提取策略 ==========
  function resolveId(resource: TData): string | number {
    if (typeof hashFn === 'function') return hashFn(resource);
    if (idKey && resource[idKey] !== undefined) return resource[idKey] as string | number;
    const defaultId = (resource as any).id;
    if (defaultId !== undefined) return defaultId;
    throw new Error('Resource ID cannot be resolved. Please provide a hashFn, idKey, or resource.id.');
  }

  // ========== 2. 核心更新策略（纯同步） ==========
  function update(newResourceList: TData[] = []) {
    // 阶段一：降低旧资源的引用计数
    for (const id of lastResourceIds) {
      const record = activeResources.get(id);
      if (record) {
        record.references--;
      }
    }

    // 阶段二：注入/更新新资源
    const newLastResourceIds: (string | number)[] = [];

    for (const data of newResourceList) {
      const id = resolveId(data);
      newLastResourceIds.push(id);
      const existingRecord = activeResources.get(id);

      if (existingRecord) {
        existingRecord.references++;
        // 存在则触发更新
        if (lifecycle.onUpdate) {
          lifecycle.onUpdate(existingRecord.instance, data);
        }
      } else {
        // 不存在则同步创建
        try {
          const realInstance = lifecycle.onCreate(data);
          activeResources.set(id, {
            instance: realInstance,
            references: 1,
          });
        } catch (err) {
          console.error(`[ResourceManager] Failed to create resource with ID: ${id}`, err);
          // 创建失败直接跳过，不进入资源池
          continue; 
        }
      }
    }

    // 阶段三：常规垃圾回收
    for (const [id, record] of activeResources.entries()) {
      if (record.references <= 0) {
        try {
          lifecycle.onDestroy(record.instance);
        } catch (err) {
          console.error(`[ResourceManager] Failed to destroy resource with ID: ${id}`, err);
        }
        activeResources.delete(id);
      }
    }

    // 阶段四：状态同步
    lastResourceIds = newLastResourceIds;
  }

  return { update };
}