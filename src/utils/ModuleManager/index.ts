import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createGlobalResourceManager } from '@/utils/GlobalResourceManager';
import { matchRoutes, extractUrlParams, debounce } from './utils';
import { ModuleManagerOptions, ModuleResourceData, ModuleResourceInstance, Props } from './type';

// 模块级标志位，确保 History API 只被劫持一次，防止多实例重复 Patch
let isHistoryPatched = false;

export const createModuleManager = (options: ModuleManagerOptions) => {
  const {
    routes,
    debounceDelay = 200,
    onRouteChange,
  } = options;
  const hashFn = (data: ModuleResourceData) => `${data.targetNode.dataset.mountId}::${data.key}`;
  // 初始化全局资源管理器，统一管理挂载节点的生命周期
  const createController = createGlobalResourceManager<ModuleResourceData, ModuleResourceInstance>(
    {
      // 直接在 target 内渲染 React 组件
      onCreate: (data) => {
        const { targetNode, component, props } = data;
        const container = document.createElement('div');
        container.dataset.mountId = hashFn(data);
        targetNode.appendChild(container);
        const root = createRoot(container);
        root.render(createElement(component, props));
        return { targetNode, container, root };
      },
      // 更新：重新渲染
      onUpdate: (instance, newData) => {
        const { component, props } = newData;
        instance.root.render(createElement(component, props));
      },
      // 卸载 React Root
      onDestroy: (instance) => {
        try {
          if (instance.container) {
            instance.container.remove();
          }
          instance.root.unmount();
        } catch (e) {
          console.error('[Mounter] Failed to unmount node', e);
        }
      },
    },
    {
      // 使用挂载 key 与目标节点 ID 组合生成资源唯一标识
      hashFn,
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
      const resourcesToSync: ModuleResourceData[] = [];

      for (const route of matchedRoutes) {
        const pathname = window.location.pathname;
        const urlParams = extractUrlParams(route.path, pathname);

        for (const moduleInfo of route.modules) {
          const { key, target, props, component } = moduleInfo;
          if (!target) continue;

          // 获取目标 DOM 节点集合
          const rawNodes = target();
          const nodes = Array.isArray(rawNodes)
            ? rawNodes.filter((n): n is HTMLElement => n instanceof HTMLElement)
            : rawNodes instanceof HTMLElement ? [rawNodes] : [];

          for (const targetNode of nodes) {
            // 为每个目标节点分配唯一 ID，供资源管理器 hashFn 使用
            if (!targetNode.dataset.mountId) {
              targetNode.dataset.mountId = `el_${++elementIdCounter}`;
            }

            // 注入 URL 参数
            const componentProps: Props = { 
              ...(typeof props === 'function' ? props(targetNode) : props),
              $params: urlParams,
            };

            resourcesToSync.push({ key,  targetNode, props: componentProps, component });
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
