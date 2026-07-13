import { MutableRefObject, ReactNode } from 'react';
import { ButtonProps, ModalProps } from 'antd';

// 1. 基础按钮 API
export interface ButtonAPI {
  buttonProps: ButtonProps;
  setType: (type: ButtonProps['type']) => void;
  setButtonProps: (props: Partial<ButtonProps>) => void;
  setText: (text: ReactNode) => void;
  setLoading: (loading: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  setIsProcessing: (value: boolean) => void;
}

// 2. 弹窗 API (保持你的动态键名设计)
export type PopupAPI<T extends readonly string[] = []> = {
  close: () => void;
  finish: () => void;
  childrenRef: MutableRefObject<any>;
} & {
  [K in T[number] as `${K}Button`]: ButtonAPI;
};

// 3. 动态事件类型
export type DynamicPopupEvents<T extends readonly string[] = []> = {
  [K in T[number] as `on${Capitalize<K>}`]?: (modalAPI: PopupAPI<T>) => void;
};

// 4. 动态按钮配置类型
type DynamicButtonConfigs<T extends readonly string[] = []> = {
  [K in T[number] as `${K}Type`]?: ButtonProps['type'];
} & {
  [K in T[number] as `${K}Text`]?: ReactNode;
} & {
  [K in T[number] as `${K}ButtonProps`]?: ButtonProps;
};

// 5. 最终的 PopupOptions
export type PopupOptions<C = ModalProps, T extends readonly string[] = []> = Omit<
  C,
  'open' | 'visible' | 'children' | 'footer' | 'onOk' | 'onCancel' | 'footerActions'
> & {
  children: ReactNode | ((api: PopupAPI<T>) => ReactNode);
  footer?: null | false | ((api: PopupAPI<T>) => ReactNode);
  footerActions?: T;
} & DynamicPopupEvents<T> &
  DynamicButtonConfigs<T>;

// 6. Open 类型
export type OpenPopup<C = ModalProps> = <T extends readonly string[] = ['cancel', 'ok']>(options: PopupOptions<C, T>) => void;