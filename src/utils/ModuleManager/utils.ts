import { RouteModuleConfig, RouteMatcher } from './type';
/**
 * 匹配当前 URL 命中的路由配置
 * 返回按优先级降序排列的匹配结果
 */
export const matchRoutes = (routes: RouteModuleConfig[]): RouteModuleConfig[] => {
  const url = new URL(window.location.href);
  return routes
    .filter((route) => {
      const { path } = route;
      if (typeof path === 'string') return url.pathname === path;
      if (path instanceof RegExp) return path.test(url.pathname);
      if (typeof path === 'function') {
        try { return path(url) === true; } catch (e) { return false; }
      }
      return false;
    })
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
};

/**
 * 从 URL 路径中提取正则捕获组的命名参数
 */
export const extractUrlParams = (path: RouteMatcher, pathname: string): Record<string, string> => {
  if (path instanceof RegExp) {
    const match = pathname.match(path);
    return match?.groups ? { ...match.groups } : {};
  }
  return {};
};

/**
 * 防抖工具函数
 */
export const debounce = <T extends (...args: any[]) => void>(fn: T, delay: number) => {
  let timeoutId: number | null = null;
  return ((...args: any[]) => {
    if (timeoutId) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay) as unknown as number;
  }) as T;
};

/**
 * 【新增】专门针对 $params 的递归深比较
 * 解决 URL 参数对象引用变化但内容未变导致的无效渲染问题
 */
const deepEqualParams = (objA: any, objB: any): boolean => {
  // 1. 严格相等或同为 null/undefined
  if (Object.is(objA, objB)) return true;
  
  // 2. 类型不一致或不是对象
  if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) {
    return false;
  }

  // 3. 处理数组（虽然 URL 参数通常是对象，但防御性编程）
  if (Array.isArray(objA) !== Array.isArray(objB)) return false;

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  // 4. 递归比较每一个键值对
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    
    const valA = objA[key];
    const valB = objB[key];

    // 如果值是对象，继续递归；否则进行基础值比较
    const areObjects = typeof valA === 'object' && valA !== null && typeof valB === 'object' && valB !== null;
    if (areObjects ? !deepEqualParams(valA, valB) : !Object.is(valA, valB)) {
      return false;
    }
  }

  return true;
};

/**
 * 【优化】定制化的浅比较工具
 * 针对 $params 进行递归内容比较，其他 props 保持引用浅比较
 */
export const shallowEqual = (objA: any, objB: any): boolean => {
  if (Object.is(objA, objB)) return true;
  if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) {
    return false;
  }

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;

    const valA = objA[key];
    const valB = objB[key];

    // 【核心处理】：如果是 $params，调用递归深比较
    if (key === '$params') {
      if (!deepEqualParams(valA, valB)) return false;
      continue;
    }

    // 其他普通 props 保持引用浅比较
    if (!Object.is(valA, valB)) return false;
  }

  return true;
};