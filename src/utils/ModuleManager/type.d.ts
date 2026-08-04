// ================= 1. 类型定义 =================
import { ComponentType } from "react";
type Props = Record<string, any>;

// 定义注入到组件中的 URL 参数类型，增强类型安全
export interface UrlParams {
  $params: Record<string, string>;
}

/**
 * 挂载配置项
 */
export interface ModuleInfo {
  // 自定义 DOM 节点选择函数
  target?: () => Element | Element[] | null | undefined;
  // 组件类型，用于创建 React 元素
  component: ComponentType<Props>;
  // 挂载参数，支持静态对象或动态计算函数
  props?: Props | ((targetNode: Element) => Props);
  // 资源唯一标识键，用于区分同一目标节点上的不同挂载实例
  key: string;
}

// 路由匹配规则：支持精确字符串、正则表达式或自定义匹配函数
export type RouteMatcher = string | RegExp | ((url: URL) => boolean);

// 路由配置项
export interface RouteModuleConfig {
  path: RouteMatcher;
  modules: ModuleInfo[];
  // 路由优先级，数值越大优先级越高
  priority?: number;
}

// Mounter 初始化选项
export interface ModuleManagerOptions {
  routes: RouteModuleConfig[];
  // 路由变化时的防抖延迟（毫秒）
  debounceDelay?: number;
  // 路由变化后的回调钩子
  onRouteChange?: () => void;
  /**
   * 全局 Provider 包装函数
   * 用于为所有注入的组件提供统一的全局上下文（如 Ant Design ConfigProvider、Redux Provider 等）
   */
  addProvider?: (children: ReactNode) => ReactNode;
}

// 资源管理器所需的数据结构
export interface ModuleResourceData {
  key: string; // 资源唯一标识
  targetNode: HTMLElement; // 目标容器节点
  component: ComponentType<any>; // 渲染组件
  props: Props; // 组件属性
}

// 资源管理器维护的实例状态
export interface ModuleResourceInstance {
  targetNode: HTMLElement;
  container: HTMLElement;
  root: Root;
  lastComponent: ComponentType<any>;
  lastProps: Props;
}
