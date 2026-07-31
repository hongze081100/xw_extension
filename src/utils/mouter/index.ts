import { createRoot, Root } from 'react-dom/client';
import React, { ReactElement } from 'react';
import { createGlobalResourceManager } from '@/utils/GlobalResourceManager';

// ================= 1. 类型定义 =================

type Props = Record<string, any>;

// 定义注入到组件中的 URL 参数类型，增强类型安全
export interface UrlParams {
  $params: Record<string, string>;
}

/**
 * 挂载配置项
 * @template TProps 组件接收的业务 Props 类型
 */
interface MountConfig<TProps extends Record<string, any> = Record<string, any>> {
  // 自定义 DOM 节点选择函数，优先级高于 selector
  select?: () => Element | Element[] | null | undefined;
  // CSS 选择器字符串，用于匹配目标挂载节点
  selector?: string;
  // 需要挂载的 React 组件，约束其 Props 必须包含业务参数与 URL 参数
  component: React.ComponentType<TProps & UrlParams>;
  // 传递给组件的 Props，支持静态对象或基于目标节点动态计算的函数
  props?: TProps | ((target: Element) => TProps);
  // 自定义容器插入逻辑，若未提供则默认 appendChild 到目标节点
  insert?: (container: HTMLElement, target: Element) => void;
  // 资源唯一标识键，用于区分同一目标节点上的不同挂载实例
  key: string;
  // 挂载容器上需要附加的 HTML 属性
  containerAttributes?: Record<string, any>;
}

// 路由匹配规则：支持精确字符串、正则表达式或自定义匹配函数
type RouteMatcher = string | RegExp | ((url: URL) => boolean);

// 路由配置项
export interface RouteConfig {
  path: RouteMatcher;
  mounts: MountConfig<any>[];
  // 路由优先级，数值越大优先级越高
  priority?: number;
}

// Provider 注入函数类型
type AddProvider = (element: ReactElement) => ReactElement;

// Mounter 初始化选项
interface MounterOptions {
  routes: RouteConfig[];
  // 路由变化时的防抖延迟（毫秒）
  debounceDelay?: number;
  // 路由变化后的回调钩子
  onRouteChange?: () => void;
  // 全局 Provider 注入器，用于包裹所有挂载的组件
  addProvider?: AddProvider;
}

// 资源管理器所需的数据结构
interface MountResourceData {
  target: HTMLElement;
  props: Props;
  mountConfig: MountConfig<any>;
}

// 资源管理器维护的实例状态
interface MountResourceInstance {
  node: HTMLElement;
  root: Root;
  lastProps?: Props; // 记录上一次渲染的 Props，用于浅比较优化
}

// ================= 2. 辅助函数 =================

/**
 * 匹配当前 URL 命中的路由配置
 * 返回按优先级降序排列的匹配结果
 */
const matchRoutes = (routes: RouteConfig[]): RouteConfig[] => {
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
const extractUrlParams = (path: RouteMatcher, pathname: string): Record<string, string> => {
  if (path instanceof RegExp) {
    const match = pathname.match(path);
    return match?.groups ? { ...match.groups } : {};
  }
  return {};
};

/**
 * 对象浅比较
 */
const shallowEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]) return false;
  }
  return true;
};

/**
 * 防抖工具函数
 */
const debounce = <T extends (...args: any[]) => void>(fn: T, delay: number) => {
  let timeoutId: number | null = null;
  return ((...args: any[]) => {
    if (timeoutId) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay) as unknown as number;
  }) as T;
};

/**
 * Props 深度比较（针对 $url 参数使用浅比较）
 * 避免每次路由变化都生成新对象导致的不必要重渲染
 */
const propsEqual = (a: Props, b: Props): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    const valA = a[key];
    const valB = b[key];
    // $url 参数使用浅比较，其余属性使用严格相等比较
    if (key === '$params') {
      if (!shallowEqual(valA, valB)) return false;
    } else if (valA !== valB) return false;
  }
  return true;
};

// ================= 3. 核心重构：createReactMounter =================

// 模块级标志位，确保 History API 只被劫持一次，防止多实例重复 Patch
let isHistoryPatched = false;

export const createReactMounter = (options: MounterOptions) => {
  const {
    routes,
    debounceDelay = 200,
    onRouteChange = null,
    addProvider,
  } = options;

  // 初始化全局资源管理器，统一管理 React Root 的生命周期
  const createController = createGlobalResourceManager<MountResourceData, MountResourceInstance>(
    {
      // 创建 React Root 实例并挂载到 DOM
      onCreate: (data) => {
        const container = document.createElement('div');
        // 设置容器自定义属性
        if (data.mountConfig.containerAttributes) {
          Object.entries(data.mountConfig.containerAttributes).forEach(([k, v]) =>
            container.setAttribute(k, String(v))
          );
        }

        // 执行自定义插入逻辑或默认追加到目标节点
        if (typeof data.mountConfig.insert === 'function') {
          data.mountConfig.insert(container, data.target);
        } else {
          data.target.appendChild(container);
        }

        const root = createRoot(container);
        let element = React.createElement(data.mountConfig.component, data.props);
        element = addProvider ? addProvider(element) : element;
        root.render(element);

        return { node: container, root, lastProps: data.props };
      },
      // 更新 Props 并触发重渲染（仅在 Props 真正变化时执行）
      onUpdate: (instance, newData) => {
        if (propsEqual(instance.lastProps || {}, newData.props)) return;
        
        let element = React.createElement(newData.mountConfig.component, newData.props);
        element = addProvider ? addProvider(element) : element;
        instance.root.render(element);
        instance.lastProps = newData.props;
      },
      // 卸载 React Root 并移除 DOM 节点
      onDestroy: (instance) => {
        try {
          instance.root.unmount();
          if (instance.node.parentNode) {
            instance.node.parentNode.removeChild(instance.node);
          }
        } catch (e) {
          console.error('[ReactMounter] Failed to unmount root', e);
        }
      },
    },
    {
      // 使用挂载 key 与目标节点 ID 组合生成资源唯一标识
      hashFn: (data) => `${data.mountConfig.key}::${data.target.dataset.mounterId}`,
    }
  );

  // 创建资源管理器控制器实例
  const controller = createController();
  // 清理函数队列，用于统一管理事件监听和 Observer 的销毁
  const cleanupFns: Array<() => void> = [];

  let elementIdCounter = 0;

 

  // 同步状态标志位，用于在资源管理器执行 DOM 操作时屏蔽 MutationObserver 回调
  // 防止"挂载组件 -> 触发 DOM 变化 -> 再次渲染"的死循环
  let isSyncing = false;

  /**
   * 核心渲染函数：匹配路由、解析 Props、同步资源池
   */
  const render = () => {
    isSyncing = true;
    try {
      const matchedRoutes = matchRoutes(routes);
      const resourcesToSync: MountResourceData[] = [];

      for (const route of matchedRoutes) {
        const pathname = window.location.pathname;
        const urlParams = extractUrlParams(route.path, pathname);

        for (const mount of route.mounts) {
          if (!mount.select && !mount.selector) continue;

          // 获取目标 DOM 节点集合
          const selectFn = mount.select || (() => document.querySelector(mount.selector!));
          const rawNodes = selectFn();
          const nodes = Array.isArray(rawNodes)
            ? rawNodes.filter((n): n is HTMLElement => n instanceof HTMLElement)
            : rawNodes instanceof HTMLElement ? [rawNodes] : [];

          for (const target of nodes) {
            // 为每个目标节点分配唯一 ID，供资源管理器 hashFn 使用
            if (!target.dataset.mounterId) {
              target.dataset.mounterId = `el_${++elementIdCounter}`;
            }

            // 统一解析 Props：支持函数动态计算或静态对象
            let resolvedProps: Props = {};
            if (typeof mount.props === 'function') {
              resolvedProps = mount.props(target);
            } else if (mount.props) {
              resolvedProps = { ...mount.props };
            }

            // 注入类型安全的 URL 参数
            resolvedProps.$params = urlParams;

            resourcesToSync.push({ target, props: resolvedProps, mountConfig: mount });
          }
        }
      }

      // 将当前活跃的节点列表交给资源管理器处理（自动创建/更新/销毁）
      controller.update(resourcesToSync);
      if (onRouteChange) onRouteChange();
    } finally {
      // 确保即使发生异常，也能恢复同步状态标志位
      isSyncing = false; 
    }
  };

  const debouncedRender = debounce(render, debounceDelay);

  /**
   * 设置路由变化监听器
   * 通过自定义事件解耦 History API 劫持，支持多实例共存
   */
  const setupRouteListeners = () => {
    const onPopState = () => debouncedRender();
    const onHashChange = () => debouncedRender();
    const onCustomRouteChange = () => debouncedRender();

    // 劫持 History API，仅在首次调用时执行
    const patchHistory = (method: 'pushState' | 'replaceState') => {
      if (isHistoryPatched) return;
      const original = window.history[method];
      window.history[method] = function (this: any, ...args: any[]) {
        const result = original.apply(this, args);
        // 触发自定义事件，所有 mounter 实例都会响应
        window.dispatchEvent(new Event('mounter:routechange'));
        return result;
      };
    };

    if (!isHistoryPatched) {
      patchHistory('pushState');
      patchHistory('replaceState');
      isHistoryPatched = true;
    }

    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('mounter:routechange', onCustomRouteChange);

    // 注册清理任务
    cleanupFns.push(() => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('mounter:routechange', onCustomRouteChange);
    });
  };

  /**
   * 设置 DOM 变化监听器
   * 在同步期间自动屏蔽回调，避免无限循环
   */
  const setupMutationObserver = () => {
    const observer = new MutationObserver(() => {
      if (isSyncing) return;
      debouncedRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    cleanupFns.push(() => observer.disconnect());
  };

  // 启动 Mounter：初始化监听器并执行首次渲染
  const start = () => {
    setupRouteListeners();
    setupMutationObserver();
    render();
  };

  // 销毁 Mounter：清理所有副作用并释放资源池
  const destroy = () => {
    cleanupFns.forEach((fn) => fn());
    controller.destroy();
  };

  return {
    start,
    destroy,
    // 暴露手动触发重渲染的能力（已防抖）
    rerender: debouncedRender,
  };
};
