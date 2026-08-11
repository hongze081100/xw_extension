import { createElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGlobalResourceManager } from '@/utils/GlobalResourceManager';
import { matchRoutes, extractUrlParams, debounce, shallowEqual } from './utils';
import { ModuleManagerOptions, ModuleResourceData, ModuleResourceInstance, Props } from './type';

let isHistoryPatched = false;

export const createModuleManager = (options: ModuleManagerOptions) => {
  const {
    routes,
    debounceDelay = 200,
    onRouteChange,
    addProvider,
  } = options;

  const hashFn = (data: ModuleResourceData) => `${data.targetNode.dataset.mountId}::${data.key}`;

  const createController = createGlobalResourceManager<ModuleResourceData, ModuleResourceInstance>(
    {
      onCreate: (data) => {
        const { targetNode, component, props } = data;
        const container = document.createElement('div');
        container.dataset.mountId = hashFn(data);
        targetNode.appendChild(container);
        
        const root = createRoot(container);
        let element: ReactNode = createElement(component, props);
        if (addProvider) element = addProvider(element);
        
        root.render(element);
        return { targetNode, container, root, lastComponent: component, lastProps: props };
      },
      // onUpdate: (instance, newData) => {
      //   const { component, props } = newData;
        
      //   // 浅比较拦截：如果组件和 Props 未变，跳过渲染
      //   if (
      //     instance.lastComponent === component && 
      //     shallowEqual(instance.lastProps, props)
      //   ) {
      //     return; 
      //   }

      //   // 更新缓存
      //   instance.lastComponent = component;
      //   instance.lastProps = props;
        
      //   let element: ReactNode = createElement(component, props);
      //   if (addProvider) element = addProvider(element);
        
      //   instance.root.render(element);
      // },
      onDestroy: (instance) => {
        try {
          instance.root.unmount();
          if (instance.container?.parentNode) {
            instance.container.parentNode.removeChild(instance.container);
          }
        } catch (e) {
          console.error('[Mounter] Failed to unmount node', e);
        }
      },
    },
    { hashFn }
  );

  const controller = createController();
  const cleanupFns: Array<() => void> = [];
  let elementIdCounter = 0;
  let isSyncing = false;

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

          const rawNodes = target();
          const nodes = Array.isArray(rawNodes)
            ? rawNodes.filter((n): n is HTMLElement => n instanceof HTMLElement)
            : rawNodes instanceof HTMLElement ? [rawNodes] : [];

          for (const targetNode of nodes) {
            if (!targetNode.dataset.mountId) {
              targetNode.dataset.mountId = `el_${++elementIdCounter}`;
            }

            const componentProps: Props = { 
              ...(typeof props === 'function' ? props(targetNode) : props),
              $params: urlParams,
            };

            resourcesToSync.push({ key, targetNode, props: componentProps, component });
          }
        }
      }

      controller.update(resourcesToSync);
      onRouteChange?.();
    } finally {
      isSyncing = false; 
    }
  };

  const debouncedRender = debounce(() => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => render());
    } else {
      render();
    }
  }, debounceDelay);

  const setupRouteListeners = () => {
    const triggerRender = () => debouncedRender();

    const patchHistory = (method: 'pushState' | 'replaceState') => {
      if (isHistoryPatched) return;
      const original = window.history[method];
      
      window.history[method] = function (this: any, ...args: any[]) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const result = original?.apply(this, args);
        window.dispatchEvent(new Event('mounter:routechange'));
        return result;
      };
      (window.history[method] as any).__mounter_patched__ = true;
    };

    if (!isHistoryPatched) {
      patchHistory('pushState');
      patchHistory('replaceState');
      isHistoryPatched = true;
    }

    window.addEventListener('popstate', triggerRender);
    window.addEventListener('hashchange', triggerRender);
    window.addEventListener('mounter:routechange', triggerRender);

    cleanupFns.push(() => {
      window.removeEventListener('popstate', triggerRender);
      window.removeEventListener('hashchange', triggerRender);
      window.removeEventListener('mounter:routechange', triggerRender);
    });
  };

  const setupMutationObserver = () => {
    const observer = new MutationObserver(() => {
      if (isSyncing) return;
      debouncedRender();
    });

    const observeBody = () => {
      if (!document.body) {
        // document_start 时机 body 可能还没创建，等 DOM 就绪后再 observe
        const handler = () => {
          if (document.body) {
            document.removeEventListener('DOMContentLoaded', handler);
            observer.observe(document.body, { childList: true, subtree: true });
          }
        };
        document.addEventListener('DOMContentLoaded', handler);
        return;
      }
      observer.observe(document.body, { childList: true, subtree: true });
    };

    observeBody();
    cleanupFns.push(() => observer.disconnect());
  };

  const start = () => {
    setupRouteListeners();
    setupMutationObserver();
    render();
  };

  const destroy = () => {
    cleanupFns.forEach((fn) => fn());
    controller.destroy();
  };

  return { start, destroy, rerender: debouncedRender };
};