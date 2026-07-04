import { MutableRefObject, ReactNode } from 'react';
import { ButtonProps, ModalProps } from 'antd';

// 按钮 API：仅保留针对单个按钮的操作
export interface ButtonAPI {
  buttonProps: ButtonProps;
  setType: (type: ButtonProps['type']) => void;
  setButtonProps: (props: Partial<ButtonProps>) => void;
  setText: (text: ReactNode) => void;
  setLoading: (loading: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  setIsProcessing: (value: boolean) => void;
}

// 弹窗 API：包含关闭、引用以及全局收尾动作
export type ModalAPI<T extends readonly string[] = []> = {
  close: () => void;
  finish: () => void; // 移至此处
  childrenRef: MutableRefObject<any>;
} & {
  [K in T[number] as `${K}Button`]: ButtonAPI;
};

// 动态生成事件处理器类型
export type DynamicModalEvents<T extends readonly string[] = []> = {
  [K in T[number] as `on${Capitalize<K>}`]?: (modalAPI: ModalAPI<T>) => void;
};

export type ModalOptions<T extends readonly string[] = []> = Omit<
  ModalProps, 
  'open' | 'visible' | 'children' | 'footer' | 'onOk' | 'onCancel'
> & {
  children: ReactNode | ((api: ModalAPI<T>) => ReactNode);
  footer?: null | false | ((api: ModalAPI<T>) => ReactNode);
} & DynamicModalEvents<T> & {
  [K in T[number] as `${K}Type`]?: ButtonProps['type'];
} & {
  [K in T[number] as `${K}Text`]?: ReactNode;
} & {
  [K in T[number] as `${K}ButtonProps`]?: ButtonProps;
};

export type OpenModal<T extends readonly string[] = []> = (options: ModalOptions<T>) => void;