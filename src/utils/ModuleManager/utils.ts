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