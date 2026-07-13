import React from 'react';
import { createRoot } from 'react-dom/client';
import { MountedInstance, MounterOptions, Props, RouteConfig, RouteMatcher } from './type';

const matchRoutes = (routes: RouteConfig[]): RouteConfig[] => {
  const url = new URL(window.location.href);
  return routes
    .filter((route) => {
      const { path } = route;
      if (typeof path === 'string') return url.pathname === path;
      if (path instanceof RegExp) return path.test(url.pathname);
      if (typeof path === 'function') {
        try {
          return path(url) === true;
        } catch (e) {
          return false;
        }
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

const shallowEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

const propsEqual = (a: Props, b: Props): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }

    const valA = a[key];
    const valB = b[key];

    if (key === '$url') {
      if (!shallowEqual(valA, valB)) {
        return false;
      }
    } else if (valA !== valB) {
      return false;
    }
  }

  return true;
};

export const createReactMounter = (options: MounterOptions) => {
  const {
    routes,
    debounceDelay = 200,
    onRouteChange = null,
    addProvider,
  } = options;

  const instances = new Map<string, MountedInstance>();
  let observer: MutationObserver | null = null;
  const cleanupFns: Array<() => void> = [];

  const debounce = <T extends (...args: any[]) => void>(
    fn: T,
    delay: number
  ) => {
    let timeoutId: number | null = null;
    return ((...args: any[]) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), delay) as unknown as number;
    }) as T;
  };

  const cleanupAllInstances = () => {
    for (const [, instance] of instances) {
      try {
        instance.root.unmount();
        if (instance.node.parentNode) {
          instance.node.parentNode.removeChild(instance.node);
        }
      } catch (e) { }
    }
    instances.clear();
  };

  const render = () => {
    const matchedRoutes = matchRoutes(routes);
    if (matchedRoutes.length === 0) return cleanupAllInstances();

    const activeKeys = new Set<string>();

    for (const route of matchedRoutes) {
      const pathname = window.location.pathname;
      const urlParams = extractUrlParams(route.path, pathname);

      for (const mount of route.mounts) {
        if (!mount.select && !mount.selector) {
          continue;
        }

        const selectFn =
          mount.select || (() => document.querySelector(mount.selector!));
        const rawNodes = selectFn();
        const nodes = Array.isArray(rawNodes)
          ? rawNodes.filter((n): n is HTMLElement => n instanceof HTMLElement)
          : rawNodes instanceof HTMLElement
            ? [rawNodes]
            : [];

        for (const target of nodes) {
          activeKeys.add(mount.key);

          const existing = instances.get(mount.key);
          const props = {
            ...mount.props,
            ...(typeof mount.getProps === 'function' ? mount.getProps() : {}),
            $url: urlParams,
          };

          let element = React.createElement(mount.component, props);
          element = addProvider ? addProvider(element) : element;

          if (existing) {
            if (!propsEqual(existing.lastProps, props)) {
              existing.lastProps = props;
              existing.root.render(element);
            }
            continue;
          }

          const container = document.createElement('div');

          if (mount.containerAttributes) {
            const attrs = mount.containerAttributes;
            const keys = Object.keys(attrs);
            for (let i = 0; i < keys.length; i++) {
              const key = keys[i];
              container.setAttribute(key, String(attrs[key]));
            }
          }

          if (typeof mount.insert === 'function') {
            mount.insert(container, target);
          } else {
            target.appendChild(container);
          }

          const root = createRoot(container);
          root.render(element);

          instances.set(mount.key, { node: container, root, lastProps: props });
        }
      }
    }

    for (const key of instances.keys()) {
      const instance = instances.get(key)!;
      if (!activeKeys.has(key) || document.body.contains(instance?.node) === false) {
        instance.root.unmount();
        if (instance.node.parentNode) {
          instance.node.parentNode.removeChild(instance.node);
        }
        instances.delete(key);
      }
    }

    if (onRouteChange) onRouteChange();
  };

  const debouncedRender = debounce(render, debounceDelay);

  const setupRouteListeners = () => {
    const onPopState = () => debouncedRender();
    const onHashChange = () => debouncedRender();

    const patchHistory = (method: 'pushState' | 'replaceState') => {
      const original = window.history[method];
      window.history[method] = function (this: any, data: any, unused: string, url?: string | URL | null) {
        const result = original.call(this, data, unused, url);
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
    observer = new MutationObserver(debouncedRender);
    observer.observe(document.body, { childList: true, subtree: true });
    cleanupFns.push(() => observer?.disconnect());
  };

  const start = () => {
    setupRouteListeners();
    setupMutationObserver();
    render();
  };

  const destroy = () => {
    cleanupAllInstances();
    cleanupFns.forEach((fn) => fn());
  };

  return {
    start,
    destroy,
    rerender: debouncedRender,
    instances,
  };
};