import { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { ButtonProps, Modal, Button, Space } from 'antd';
import { OpenModal, ModalOptions, ModalAPI, ButtonAPI } from './type';
export * from './type.d';

const DEFAULT_BUTTON_KEYS = ['cancel', 'ok'] as const;
type DefaultButtonKeys = typeof DEFAULT_BUTTON_KEYS;
const buttonTextMap: Record<string, string> = {
  cancel: '取消',
  ok: '确定',
};

// 1. 无参调用重载
export function useControlledModal(): [OpenModal<DefaultButtonKeys>, ReactNode];
// 2. 自定义参数重载
export function useControlledModal<T extends readonly string[]>(
  buttonKeys: T
): [OpenModal<T>, ReactNode];

// 3. 函数实现
export function useControlledModal<T extends readonly string[] = DefaultButtonKeys>(
  buttonKeys: T = DEFAULT_BUTTON_KEYS as unknown as T
): [OpenModal<T>, ReactNode] {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ModalOptions<T> | null>(null);
  const [buttonMap, setButtonMap] = useState<Record<string, ButtonProps>>({});
  
  const childrenRef = useRef<any>(null);
  const buttonMapRef = useRef(buttonMap);
  buttonMapRef.current = buttonMap;

  // 修复闭包陷阱：将 options 存入 ref
  const optionsRef = useRef<ModalOptions<T> | null>(null);
  optionsRef.current = options;

  // 稳定引用：更新单个按钮状态的方法
  const createButtonAPI = useCallback((key: string): ButtonAPI => {
    return {
      get buttonProps() {
        return buttonMapRef.current[key] || {};
      },
      setType: (type) => {
        setButtonMap(prev => ({ ...prev, [key]: { ...prev[key], type } }));
      },
      setButtonProps: (props) => {
        setButtonMap(prev => ({ ...prev, [key]: { ...prev[key], ...(props as any) } }));
      },
      setText: (text) => {
        setButtonMap(prev => ({ ...prev, [key]: { ...prev[key], children: text } }));
      },
      setLoading: (loading) => {
        setButtonMap(prev => ({ ...prev, [key]: { ...prev[key], loading } }));
      },
      setDisabled: (disabled) => {
        setButtonMap(prev => ({ ...prev, [key]: { ...prev[key], disabled } }));
      },
      setIsProcessing: (value) => {
        setButtonMap(prev => {
          const newMap = { ...prev };
          for (const k of Object.keys(newMap)) {
            if (k === key) {
              newMap[k] = { ...newMap[k], loading: value };
            } else {
              newMap[k] = { ...newMap[k], disabled: value };
            }
          }
          return newMap;
        });
      },
    };
  }, []);

  // 构建稳定的 modalAPI
  const modalAPI = useMemo<ModalAPI<T>>(() => {
    const api: any = {
      close: () => setOpen(false),
      childrenRef,
      // 全局收尾：重置所有按钮状态并关闭弹窗
      finish: () => {
        setButtonMap(prev => {
          const newMap = { ...prev };
          for (const k of Object.keys(newMap)) {
            newMap[k] = { ...newMap[k], loading: false, disabled: false };
          }
          return newMap;
        });
        setOpen(false);
      },
    };
    for (const key of buttonKeys) {
      api[`${key}Button`] = createButtonAPI(key);
    }
    return api;
  }, [buttonKeys, createButtonAPI]); 

  // 完善类型约束：打开弹窗
  const openModal = useCallback<OpenModal<T>>((opts) => {
    const newButtonMap: Record<string, ButtonProps> = {};

    for (const key of buttonKeys) {
      const props: ButtonProps = {
        ...(opts as any)[`${key}ButtonProps`],
        type: (opts as any)[`${key}Type`],
        children: (opts as any)[`${key}Text`],
      };
      newButtonMap[key] = props;
    }

    setButtonMap(newButtonMap);
    setOptions(opts);
    setOpen(true);
  }, [buttonKeys]);

  // 修复闭包陷阱：统一处理按钮点击事件
  const handleButtonClick = useCallback((key: string) => {
    const handlerName = `on${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof ModalOptions<T>;
    const handler = optionsRef.current?.[handlerName];

    if (typeof handler === 'function') {
      handler(modalAPI);
      return;
    }
    
    // 默认行为：如果没有拦截，则关闭弹窗
    setOpen(false);
  }, [modalAPI]);

  // destroyOnClose 与状态重置：动画结束后清理
  const handleAfterClose = useCallback(() => {
    setOptions(null);
    setButtonMap({});
  }, []);

  // 动态渲染 Footer
  const renderFooter = useCallback(() => {
    if (options?.footer === null || options?.footer === false) {
      return null;
    }

    if (typeof options?.footer === 'function') {
      return options.footer(modalAPI);
    }

    return (
      <Space>
        {buttonKeys.map((key, index) => {
          const btnProps = buttonMap[key] || {};
          const defaultType = index === buttonKeys.length - 1 ? 'primary' : 'default';
          
          return (
            <Button
              key={key}
              {...btnProps}
              type={btnProps.type || defaultType}
              onClick={() => handleButtonClick(key)}
            >
              {btnProps.children || buttonTextMap[key] || key}
            </Button>
          );
        })}
      </Space>
    );
  }, [options, modalAPI, buttonKeys, buttonMap, handleButtonClick]);

  const { children, footer, ...restProps } = options || {};

  const modalNode = options ? (
    <Modal
      {...restProps}
      open={open}
      destroyOnClose
      afterClose={handleAfterClose}
      footer={renderFooter()}
      onOk={undefined} 
      onCancel={() => handleButtonClick('cancel')}
    >
      {typeof children === 'function' ? children(modalAPI) : children}
    </Modal>
  ) : null;

  return [openModal, modalNode];
}