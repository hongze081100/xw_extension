import { SetStateAction, useRef, useState } from 'react';
import { ControlValueInstance, ControlValueOptions } from './type';


export function useControlValue<T = any>(
  props: Record<string, any>,
  options: ControlValueOptions = {},
): [T, (newValue: SetStateAction<T>, ...args: any[]) => void] {
  const {
    defaultValuePropName = 'defaultValue',
    valuePropName = 'value',
    trigger = 'onChange',
  } = options || {};

  const defaultValue = props[defaultValuePropName] as T;
  const value = props[valuePropName] as T;
  const onChange = props[trigger];

  // 1. 缓存最新的 onChange，避免闭包陈旧问题
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 2. 仅在初始化时判断一次是否受控，后续不再变动
  const isControlledRef = useRef(
    Object.prototype.hasOwnProperty.call(props, valuePropName)
  );

  // 3. 手动触发组件重渲染的函数
  const [, forceUpdate] = useState({});

  // 4. 核心实例，整个生命周期只创建一次
  const ref = useRef<ControlValueInstance<T>>();
  if (!ref.current) {
    ref.current = createControlValueInstance({
      value: isControlledRef.current ? value : defaultValue,
      onChange: (...args) => {
        onChangeRef.current?.(...args);
      },
      forceUpdate: () => forceUpdate({}),
    });
  }

  // 5. 如果处于受控模式，每次渲染都同步外部最新的 value
  if (isControlledRef.current) {
    ref.current.value = value;
  }

  const { value: currentValue, setValue } = ref.current;
  return [currentValue, setValue];
}

function createControlValueInstance<T>(controlValueOptions: {
  value: T;
  onChange?: (newValue: SetStateAction<T>, ...args: any[]) => void;
  forceUpdate: VoidFunction;
}) {
  const { value, onChange, forceUpdate } = controlValueOptions;

  const inst: ControlValueInstance<T> = {
    value,
    setValue: (newValue: SetStateAction<T>, ...args: any[]) => {
      // 支持函数式更新
      const currentValue = isFunction(newValue) ? newValue(inst.value) : newValue;

      // 核心优化：如果值没有变化，直接跳过更新，避免不必要的重渲染
      if (Object.is(inst.value, currentValue)) return;

      inst.value = currentValue;
      forceUpdate();

      if (isFunction(onChange)) {
        onChange(currentValue, ...args);
      }
    },
  };
  return inst;
}

function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}