import { createRoot, Root } from 'react-dom/client';
import React, { ReactElement } from 'react';
import { createResourceManager } from '../ResourceManager';


type Props = Record<string, any>;

interface MountConfig {
  select?: () => Element | Element[] | null | undefined;
  selector?: string;
  component: React.ComponentType<any>;
  props?: Props;
  getProps?: () => Props;
  getPropsForTarget?: (target: Element) => Props;
  insert?: (container: HTMLElement, target: Element) => void;
  key: string;
  containerAttributes?: Record<string, any>;
}

type RouteMatcher = string | RegExp | ((url: URL) => boolean);

export interface RouteConfig {
  path: RouteMatcher;
  mounts: MountConfig[];
  priority?: number;
}

type AddProvider = (element: ReactElement) => ReactElement;

interface MounterOptions {
  routes: RouteConfig[];
  debounceDelay?: number;
  onRouteChange?: () => void;
  addProvider?: AddProvider;
}

// 1. 定义 React 挂载资源的“数据契约”
interface ReactMountData {
  component: React.ComponentType<any>;
  props: Props;
  target: HTMLElement;
  mountConfig: MountConfig;
}

// 2. 定义 React 挂载资源的“实例形态”
interface ReactMountInstance {
  node: HTMLElement;
  root: Root;
}

// 3. 定义 React 挂载的生命周期（纯同步）
const reactMountLifecycle = {
  onCreate: (data: ReactMountData): ReactMountInstance => {
    const { component, props, target, mountConfig } = data;
    const container = document.createElement('div');

    if (mountConfig.containerAttributes) {
      const attrs = mountConfig.containerAttributes;
      for (const key of Object.keys(attrs)) {
        container.setAttribute(key, String(attrs[key]));
      }
    }

    if (typeof mountConfig.insert === 'function') {
      mountConfig.insert(container, target);
    } else {
      target.appendChild(container);
    }

    const root = createRoot(container);
    root.render(React.createElement(component, props));

    return { node: container, root };
  },

  onUpdate: (instance: ReactMountInstance, data: ReactMountData) => {
    // 仅当 Props 发生变化时重新渲染
    // 注意：这里可以复用你之前的 propsEqual 逻辑
    // 为了极简，这里直接 render，React 内部也会做 diff
    instance.root.render(React.createElement(data.component, data.props));
  },

  onDestroy: (instance: ReactMountInstance) => {
    instance.root.unmount();
    if (instance.node.parentNode) {
      instance.node.parentNode.removeChild(instance.node);
    }
  }
};

// 4. 重构后的 Mounter 工厂函数
export const createReactMounter = (options: MounterOptions) => {
  const {
    routes,
    debounceDelay = 200,
    onRouteChange = null,
    addProvider,
  } = options;

  // 使用 ResourceManager 管理 React 实例
  const manager = createResourceManager<ReactMountData, ReactMountInstance>(
    reactMountLifecycle,
    {
      // 使用 mount.key + target 的唯一标识作为 Hash
      hashFn: (data) => `${data.mountConfig.key}::${getElementId(data.target)}`
    }
  );

  // 复用之前的 DOM ID 生成逻辑（WeakMap 防止内存泄漏）
  const elementIdMap = new WeakMap<HTMLElement, string>();
  let elementIdCounter = 0;
  const getElementId = (el: HTMLElement): string => {
    const existing = elementIdMap.get(el);
    if (existing) return existing;
    const id = `el_${++elementIdCounter}`;
    elementIdMap.set(el, id);
    return id;
  };

  // 复用路由匹配与 URL 参数提取
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

  const extractUrlParams = (path: RouteMatcher, pathname: string): Props => {
    if (path instanceof RegExp) {
      const match = pathname.match(path);
      return match?.groups ? { ...match.groups } : {};
    }
    return {};
  };

  // 核心渲染逻辑被极度简化
  const render = () => {
    const matchedRoutes = matchRoutes(routes);
    const pathname = window.location.pathname;
    
    // 收集当前需要挂载的所有 React 资源
    const resourcesToMount: ReactMountData[] = [];

    for (const route of matchedRoutes) {
      const urlParams = extractUrlParams(route.path, pathname);

      for (const mount of route.mounts) {
        if (!mount.select && !mount.selector) continue;

        const selectFn = mount.select || (() => document.querySelector(mount.selector!));
        const rawNodes = selectFn();
        const nodes = Array.isArray(rawNodes)
          ? rawNodes.filter((n): n is HTMLElement => n instanceof HTMLElement)
          : rawNodes instanceof HTMLElement ? [rawNodes] : [];

        for (const target of nodes) {
          const props = {
            ...mount.props,
            ...(typeof mount.getProps === 'function' ? mount.getProps() : {}),
            ...(typeof mount.getPropsForTarget === 'function' ? mount.getPropsForTarget(target) : {}),
            $url: urlParams,
          };

          let element = React.createElement(mount.component, props);
          element = addProvider ? addProvider(element) : element;

          resourcesToMount.push({
            component: mount.component,
            props, // 传入处理后的 props
            target,
            mountConfig: mount,
          });
        }
      }
    }

    // 将收集到的资源列表交给 Manager，它会自动处理 创建/更新/销毁
    manager.update(resourcesToMount);

    if (onRouteChange) onRouteChange();
  };

  // 防抖与事件监听逻辑保持不变
  const debounce = <T extends (...args: any[]) => void>(fn: T, delay: number) => {
    let timeoutId: number | null = null;
    return ((...args: any[]) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), delay) as unknown as number;
    }) as T;
  };

  const debouncedRender = debounce(render, debounceDelay);
  const cleanupFns: Array<() => void> = [];

  const setupRouteListeners = () => {
    const onPopState = () => debouncedRender();
    const onHashChange = () => debouncedRender();
    const patchHistory = (method: 'pushState' | 'replaceState') => {
      const original = window.history[method];
      window.history[method] = function (this: any, ...args: any[]) {
        const result = original.apply(this, args);
        debouncedRender();
        return result;
      };
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    patchHistory('pushState');
    patchHistory('replaceState');
    cleanupFns.push(() => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    });
  };

  const setupMutationObserver = () => {
    const observer = new MutationObserver(debouncedRender);
    observer.observe(document.body, { childList: true, subtree: true });
    cleanupFns.push(() => observer.disconnect());
  };

  const start = () => {
    setupRouteListeners();
    setupMutationObserver();
    render();
  };

  const destroy = () => {
    manager.update([]); // 传入空数组，触发全量销毁
    cleanupFns.forEach((fn) => fn());
  };

  return { start, destroy, rerender: debouncedRender };
};