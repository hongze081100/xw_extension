import React, { MutableRefObject, useCallback, useMemo, useRef, useState } from 'react';
import { ButtonProps, Button, Space } from 'antd';
import { PopupOptions, ButtonAPI, PopupAPI } from './type';

const DEFAULT_FOOTER_ACTIONS = ['cancel', 'ok'] as const;
const buttonTextMap: Record<string, string> = {
  cancel: '取消',
  ok: '确定',
};

/**
 * 0. 工具函数：安全地判断一个值是否为函数
 * 提取此函数不仅提升可读性，还避免了在调用处进行 (handler as Function) 的强制类型断言
 */
const isFunction = (value: unknown): value is Function => {
  return typeof value === 'function';
};

/**
 * 1. 将 Context 创建逻辑抽离，确保类型安全与闭包状态隔离
 */
function createPopupContext(childrenRef: MutableRefObject<any>, onUpdate: VoidFunction) {
  // 使用对象存储状态，避免闭包陷阱，确保 API 读取到最新状态
  let state = {
    open: false,
    options: null as PopupOptions<any,any> | null,
    buttonMap: {} as any as Record<string, ButtonProps>,
  };

  const getFooterActions = () =>
    state.options?.footerActions || (DEFAULT_FOOTER_ACTIONS as unknown as readonly string[]);

  const setState = (newState: Partial<typeof state>) => {
    state = { ...state, ...newState };
    onUpdate();
  };

  // 按钮 API 工厂函数
  const createButtonAPI = (key: string): ButtonAPI => ({
    get buttonProps() {
      return state.buttonMap[key] || {};
    },
    setType: (type) => {
      setState({ buttonMap: { ...state.buttonMap, [key]: { ...state.buttonMap[key], type } } });
    },
    setButtonProps: (props) => {
      setState({
        buttonMap: { ...state.buttonMap, [key]: { ...state.buttonMap[key], ...props } as any as ButtonProps },
      });
    },
    setText: (text) => {
      setState({ buttonMap: { ...state.buttonMap, [key]: { ...state.buttonMap[key], children: text } } });
    },
    setLoading: (loading) => {
      setState({ buttonMap: { ...state.buttonMap, [key]: { ...state.buttonMap[key], loading } } });
    },
    setDisabled: (disabled) => {
      setState({ buttonMap: { ...state.buttonMap, [key]: { ...state.buttonMap[key], disabled } } });
    },
    setIsProcessing: (value) => {
      const newMap = { ...state.buttonMap };
      for (const k of Object.keys(newMap)) {
        newMap[k] = {
          ...newMap[k],
          loading: k === key ? value : newMap[k].loading,
          disabled: k !== key ? value : newMap[k].disabled,
        };
      }
      setState({ buttonMap: newMap });
    },
  });

  // 动态生成 API
  const buildApi = (): PopupAPI<any> => {
    const api: any = {
      close: () => setState({ open: false }),
      finish: () => {
        const newButtonMap = { ...state.buttonMap };
        for (const k of Object.keys(newButtonMap)) {
          newButtonMap[k] = { ...newButtonMap[k], loading: false, disabled: false };
        }
        setState({ open: false, buttonMap: newButtonMap });
      },
      childrenRef,
    };

    // 动态挂载按钮 API
    for (const key of getFooterActions()) {
      api[`${key}Button`] = createButtonAPI(key);
    }
    return api;
  };

  return {
    getState: () => ({ ...state, api: buildApi() }),
    openModal: (opts: PopupOptions<any, any>) => {
      const actions = opts.footerActions || (DEFAULT_FOOTER_ACTIONS);
      const newButtonMap: Record<string, ButtonProps> = {};

      for (const key of actions) {
        newButtonMap[key] = {
          ...(opts as any)[`${key}ButtonProps`],
          type: (opts as any)[`${key}Type`],
          children: (opts as any)[`${key}Text`],
        };
      }

      setState({ open: true, options: opts as PopupOptions<any, any>, buttonMap: newButtonMap });
    },
    handleEvent: (key: string) => {
      const api = buildApi();
      const handlerName = `on${key.charAt(0).toUpperCase() + key.slice(1)}`;
      const handler = state.options?.[handlerName as keyof typeof state.options];

      // 使用 isFunction 进行类型守卫判断，逻辑更加优雅且类型安全
      if (isFunction(handler)) {
        handler(api);
        return;
      }

      // 默认如果没有绑定自定义事件，则关闭弹窗
      setState({ open: false });
    },
    handleAfterClose: () => {
      // 彻底清理状态，防止内存泄漏
      setState({ open: false, options: null, buttonMap: {} });
    },
  };
}

export function usePopup() {
  const [, forceUpdate] = useState({});
  const childrenRef = useRef<any>(null);
  const contextRef = useRef<ReturnType<typeof createPopupContext> | null>(null);

  const openFn = useCallback((opts: PopupOptions<any, any>) => {
    // 每次打开都重新创建 Context，确保状态完全隔离且无内存泄漏
    contextRef.current = createPopupContext(childrenRef, () => forceUpdate({}));
    contextRef.current.openModal(opts);
  }, []);

  const ctx = contextRef.current;
  const currentState = ctx?.getState();
  const { open, options, buttonMap, api } = currentState || {};
  const { footerActions: optFooterActions, footer } = options || {};
  const footerActions = optFooterActions || DEFAULT_FOOTER_ACTIONS;

  // 3. Footer 渲染逻辑优化
  const footerNode = useMemo(() => {
    if (footer === null || footer === false) return null;
    if (isFunction(footer)) return footer(api!);

    return (
      <Space>
        {footerActions.map((key: string, index: number) => {
          const btnProps = buttonMap?.[key] || {};
          const isPrimary = index === footerActions.length - 1;
          const handleClick = () => ctx?.handleEvent(key);
          return (
            <Button
              key={key}
              {...btnProps}
              type={btnProps.type || (isPrimary ? 'primary' : 'default')}
              onClick={handleClick}
            >
              {btnProps.children || buttonTextMap[key] || key}
            </Button>
          );
        })}
      </Space>
    );
  }, [api, buttonMap, ctx, footer, footerActions]);

  const renderChildren = () => {
    if (!options) {
      return null;
    }
    return isFunction(options.children) ? options.children(api!) : options.children;
  };
  const handleAfterClose = useCallback(() => ctx?.handleAfterClose(), [ctx]);
  const handleCancel = useCallback(() => ctx?.handleEvent('cancel'), [ctx]);

  return {
    open,
    options,
    buttonMap,
    api,
    ctx,
    footerNode: options ? footerNode : null,
    childrenNode: renderChildren(),
    openFn,
    handleAfterClose,
    handleCancel,
  };
}
