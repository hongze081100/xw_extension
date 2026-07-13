/**
 * defineEnum 核心运行时逻辑
 */

import { 
  PK, 
  type DefineEnumItem, 
  type DefineEnumReturnType 
} from './type';

// 统一导出所有类型，方便外部引入
export * from './type';

// ==================== 运行时工具函数 ====================

/**
 * 将任意格式的 key 转换为大写下划线格式的常量键
 */
function constantKey(key: string): string {
  if (key.includes('_')) return key.toUpperCase();
  if (key.includes('-')) return key.replace(/-/g, '_').toUpperCase();
  return key.replace(/([^A-Z])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * 根据优先级数组从对象中提取主键的值
 */
function primaryKey(obj: object, keys: readonly string[]): string {
  for (const key of keys) {
    if (key in obj) return String((obj as any)[key]);
  }
  return '';
}

// ==================== 核心工厂函数 ====================

/**
 * 定义一个类型安全的枚举对象
 * @param source 枚举项数组，强烈建议传入 `as const` 以获得完整的类型推导
 */
export function defineEnum<T extends readonly DefineEnumItem[]>(source: T): DefineEnumReturnType<T> {
  // 1. 预构建映射表，避免在 Proxy 拦截时重复计算
  const refs: Record<string, DefineEnumItem> = {};
  
  // 2. 方法缓存，避免每次 get 拦截都创建新函数（防止引发 React/Vue 无限重渲染）
  const isMethodCache: Record<string, (value: any) => boolean> = {};
  const getMethodCache: Record<string, (fieldName: string) => any> = {};

  // 初始化映射表
  for (const item of source) {
    const key = constantKey(primaryKey(item, PK));
    refs[key] = item;
  }

  // 3. 使用 Proxy 拦截属性访问，动态生成常量和工具方法
  return new Proxy(source, {
    get(target: any, propertyName: PropertyKey) {
      // 修复类型问题：确保 propertyName 是字符串
      if (typeof propertyName !== 'string') {
        return target[propertyName];
      }

      // 优先返回数组原生属性（如 length, map 等），避免破坏原生数组行为
      if (propertyName in target) {
        return target[propertyName];
      }

      // 处理 isXxx 方法：判断传入的值是否等于当前枚举项的 value
      if (propertyName.startsWith('is')) {
        if (!isMethodCache[propertyName]) {
          const key = constantKey(propertyName.slice(2));
          const ref = refs[key];
          isMethodCache[propertyName] = (value: any) => ref?.value === value;
        }
        return isMethodCache[propertyName];
      }

      // 处理 getXxx 方法：根据传入的 value 获取对应枚举项的指定字段
      if (propertyName.startsWith('get')) {
        if (!getMethodCache[propertyName]) {
          const key = constantKey(propertyName.slice(3));
          const ref = refs[key];
          getMethodCache[propertyName] = (fieldName: string) => ref?.[fieldName];
        }
        return getMethodCache[propertyName];
      }

      // 处理全大写常量访问 (如 MY_ENUM_ITEM)
      if (propertyName === propertyName.toUpperCase()) {
        return refs[propertyName];
      }

      // 兜底：返回原数组上的属性
      return target[propertyName];
    },
  }) as unknown as DefineEnumReturnType<T>;
}