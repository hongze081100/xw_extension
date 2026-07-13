
export type Props = Record<string, any>;

export interface MountConfig {
  select?: () => Element | Element[] | null | undefined;
  selector?: string;
  component: React.ComponentType<any>;
  props?: Props;
  getProps?: () => Props;
  insert?: (container: HTMLElement, target: Element) => void;
  key: string;
  containerAttributes?: Record<string, any>;
}

export type RouteMatcher = string | RegExp | ((url: URL) => boolean);

export interface RouteConfig {
  path: RouteMatcher;
  mounts: MountConfig[];
  priority?: number;
}

export type AddProvider = (element: ReactElement) => ReactElement;

export interface MounterOptions {
  routes: RouteConfig[];
  debounceDelay?: number;
  onRouteChange?: () => void;
  addProvider?: AddProvider;
}

export interface MountedInstance {
  node: HTMLElement;
  root: Root;
  lastProps: Props;
}
