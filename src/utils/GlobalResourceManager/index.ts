/**
 * 资源生命周期钩子定义（极简同步版）
 */
interface ResourceLifecycle<TData, TInstance> {
  onCreate: (data: TData) => TInstance;
  onUpdate?: (instance: TInstance, newData: TData) => void;
  onDestroy: (instance: TInstance) => void;
}

/**
 * 资源管理器配置项
 * 【类型安全加固】：利用泛型约束，确保 idKey 必须是 TData 的键，
 * 并且该键对应的值类型必须严格为 string | number。
 */
interface ResourceManagerOptions<TData> {
  hashFn?: (data: TData) => string | number;
  idKey?: {
    [K in keyof TData]: TData[K] extends string | number ? K : never;
  }[keyof TData];
}

/**
 * 内部维护的资源状态记录
 */
interface ResourceRecord<TInstance> {
  instance: TInstance;
  references: number;
}

/**
 * 控制器接口：模块与全局资源池交互的把手
 */
interface ResourceController<TData> {
  update: (newResourceList?: TData[]) => void;
  destroy: () => void;
}

/**
 * 创建全局资源管理器（单例工厂）
 * 用于统一管理昂贵资源的创建、更新与垃圾回收
 */
export function createGlobalResourceManager<TData, TInstance>(
  lifecycle: ResourceLifecycle<TData, TInstance>,
  options: ResourceManagerOptions<TData> = {}
) {
  const { idKey, hashFn } = options;

  // 【核心】提升为全局共享的状态池
  const activeResources = new Map<string | number, ResourceRecord<TInstance>>();

  // ========== 1. 多级 ID 提取策略 ==========
  function resolveId(resource: TData): string | number {
    if (typeof hashFn === 'function') return hashFn(resource);
    
    // 【类型安全加固】：由于接口层已做泛型约束，这里可以直接安全取值，
    // 彻底抛弃了危险的 `as string` 断言，TS 能准确推断出值为 string | number | undefined。
    if (idKey !== undefined) {
      const value = resource[idKey];
      if (value !== undefined) return value as string | number;
    }

    // 回退到默认的 id 属性
    const defaultId = (resource as any).id;
    if (defaultId !== undefined) return defaultId;

    throw new Error('Resource ID cannot be resolved. Please provide a hashFn, idKey, or resource.id.');
  }

  // ========== 2. 内部辅助：执行垃圾回收 ==========
  function performGarbageCollection() {
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
  }

  // ========== 3. 返回独立的控制器闭包（模块级绑定） ==========
  return function createController(): ResourceController<TData> {
    let lastResourceIds: (string | number)[] = [];
    let isDestroyed = false;

    function update(newResourceList: TData[] = []) {
      if (isDestroyed) {
        console.warn('[ResourceManager] Cannot update a destroyed controller.');
        return;
      }

      // 阶段一：降低旧资源的引用计数
      for (const id of lastResourceIds) {
        const record = activeResources.get(id);
        if (record) record.references--;
      }

      // 阶段二：注入/更新新资源
      const newLastResourceIds: (string | number)[] = [];
      for (const data of newResourceList) {
        const id = resolveId(data);
        const existingRecord = activeResources.get(id);

        if (existingRecord) {
          existingRecord.references++;
          try {
            lifecycle.onUpdate?.(existingRecord.instance, data);
          } catch (err) {
            console.error(`[ResourceManager] Failed to update resource with ID: ${id}`, err);
          }
          newLastResourceIds.push(id);
        } else {
          let createdSuccessfully = false;
          try {
            const instance = lifecycle.onCreate(data);
            activeResources.set(id, { instance, references: 1 });
            createdSuccessfully = true;
          } catch (err) {
            console.error(`[ResourceManager] Failed to create resource with ID: ${id}`, err);
          }
          if (createdSuccessfully) {
            newLastResourceIds.push(id);
          }
        }
      }

      // 阶段三：全局垃圾回收
      performGarbageCollection();

      // 阶段四：状态同步
      lastResourceIds = newLastResourceIds;
    }

    // 【加固点】控制器销毁：主动释放当前模块持有的所有引用
    function destroy() {
      if (isDestroyed) return;
      for (const id of lastResourceIds) {
        const record = activeResources.get(id);
        if (record) record.references--;
      }
      performGarbageCollection();
      lastResourceIds = [];
      isDestroyed = true;
    }

    return { update, destroy };
  };
}