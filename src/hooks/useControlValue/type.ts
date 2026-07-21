import { SetStateAction } from "react";

export interface ControlValueOptions {
  defaultValuePropName?: string;
  valuePropName?: string;
  trigger?: string;
}

export interface ControlValueInstance<T> {
  value: T;
  setValue: (newValue: SetStateAction<T>, ...args: any[]) => void;
}