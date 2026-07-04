
# useControlledModal 使用文档

`useControlledModal` 是一个基于 React + Ant Design 的高阶自定义 Hook。它通过 TypeScript 泛型推导，实现了**命令式调用**、**动态按钮配置**以及**类型安全的异步状态管理**，完美解决了传统 Modal 在复杂表单交互中状态管理繁琐、闭包陷阱频发的问题。

---

## 🚀 快速开始

### 1. 基础用法（默认按钮）
不传参时，默认提供 `cancel` 和 `ok` 两个按钮，并自动推导 `onCancel`、`onOk` 等事件类型。

```tsx
import { useControlledModal } from './useControlledModal';

const MyComponent = () => {
  const [openModal, modalNode] = useControlledModal();

  const handleDelete = () => {
    openModal({
      title: '确认删除',
      children: '删除后不可恢复，是否继续？',
      onOk: (api) => {
        console.log('执行删除');
        api.finish(); // 重置状态并关闭
      },
    });
  };

  return (
    <>
      <Button onClick={handleDelete}>删除</Button>
      {modalNode}
    </>
  );
};
```

### 2. 自定义按钮与异步提交
通过传入 `as const` 数组，自动推导自定义按钮的事件、文本和 API。

```tsx
const [openModal, modalNode] = useControlledModal(['submit', 'cancel'] as const);

const handleEdit = () => {
  openModal({
    title: '编辑用户',
    submitText: '保存修改',       // 自动推导 submitText
    submitType: 'primary',      // 自动推导 submitType
    onSubmit: async (api) => {  // 自动推导 onSubmit
      api.submitButton.setIsProcessing(true); // 当前 loading + 其他 disabled
      try {
        await saveUser();
        message.success('保存成功');
        api.finish(); // 优雅收尾：重置状态 + 关闭弹窗
      } catch (e) {
        api.submitButton.setIsProcessing(false); // 恢复按钮状态
      }
    },
    children: <UserForm />,
  });
};
```

---

## 📖 API 参考

### `useControlledModal(buttonKeys?)`

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `buttonKeys` | `readonly string[]` | 可选。自定义按钮 key 数组，如 `['submit', 'cancel']`。不传则默认为 `['cancel', 'ok']`。 |
| **返回值** | `[OpenModal, ReactNode]` | 返回一个元组：`[打开弹窗的方法, 弹窗节点]`。 |

---

### `OpenModal(options)`

打开弹窗的方法，接收 `ModalOptions` 配置对象。

#### `ModalOptions` 核心配置

| 属性 | 类型 | 说明 |
| :--- | :--- | :--- |
| `children` | `ReactNode \| (api) => ReactNode` | 弹窗内容。支持函数形式，可接收 `modalAPI`。 |
| `footer` | `null \| false \| (api) => ReactNode` | 自定义底部。传 `null/false` 隐藏，传函数可完全接管渲染。 |
| `on[Key]` | `(api: ModalAPI) => void` | 动态事件。如 `onSubmit`、`onConfirm`，**点击对应按钮时触发**。 |
| `[key]Text` | `ReactNode` | 动态按钮文本。如 `submitText: '保存'`。 |
| `[key]Type` | `ButtonProps['type']` | 动态按钮类型。如 `submitType: 'primary'`。 |
| `[key]ButtonProps` | `ButtonProps` | 动态按钮完整属性。如 `submitButtonProps: { danger: true }`。 |
| `...restProps` | `ModalProps` | 支持所有 Ant Design Modal 原生属性（除 `open`, `footer`, `onOk` 等被接管属性）。 |

---

### `ModalAPI<T>`

在事件回调或 `children` 函数中可获取的 API 对象，用于控制弹窗和按钮状态。

| 方法/属性 | 类型 | 说明 |
| :--- | :--- | :--- |
| `close()` | `() => void` | **物理关闭**。仅执行 `setOpen(false)`，不重置按钮状态。适用于“取消”操作。 |
| `finish()` | `() => void` | **业务收尾**。重置所有按钮的 `loading/disabled` 状态，并关闭弹窗。适用于“提交成功”后的优雅退出。 |
| `childrenRef` | `MutableRefObject<any>` | 用于获取弹窗内部子组件的 Ref，方便在外部调用子组件方法（如 `form.validateFields()`）。 |
| `[key]Button` | `ButtonAPI` | 动态按钮控制器。如 `submitButton`、`cancelButton`。 |

---

### `ButtonAPI`

针对单个按钮的精细化控制 API。

| 方法 | 参数 | 说明 |
| :--- | :--- | :--- |
| `setLoading` | `(loading: boolean) => void` | 设置当前按钮的 loading 状态。 |
| `setDisabled` | `(disabled: boolean) => void` | 设置当前按钮的 disabled 状态。 |
| `setText` | `(text: ReactNode) => void` | 动态修改按钮文本。 |
| `setType` | `(type: ButtonProps['type']) => void` | 动态修改按钮类型。 |
| `setButtonProps` | `(props: Partial<ButtonProps>) => void` | 批量设置按钮属性。 |
| `setIsProcessing` | `(value: boolean) => void` | **一键防抖**：`true` 时当前按钮 loading + 其他按钮 disabled；`false` 时恢复。 |
| `buttonProps` | `ButtonProps` | 只读属性，获取当前按钮的最新 Props。 |

---

## 💡 核心设计理念

### 1. `close()` vs `finish()`
- **`close()`**：纯粹的“取消”动作。直接关闭弹窗，不关心按钮状态。适用于点击遮罩层、按 Esc、点击“取消”按钮。
- **`finish()`**：完整的“成功收尾”动作。先清理异步状态（loading/disabled），再关闭弹窗。适用于 `onSubmit` 成功后的回调，防止下次打开弹窗时残留脏数据。

### 2. 闭包陷阱修复
内部使用 `optionsRef` 和 `buttonMapRef` 缓存最新状态，确保 `handleButtonClick` 和 `ButtonAPI` 中的方法始终能访问到最新的回调函数和按钮状态，无需在依赖项中声明 `options`，避免不必要的重渲染。

### 3. 类型安全
通过 TypeScript 的 `Capitalize`、模板字符串类型和映射类型，实现了：
```typescript
// 传入 ['submit', 'cancel'] as const
// 自动推导：
// - onSubmit: (api: ModalAPI) => void
// - submitText: ReactNode
// - submitButton: ButtonAPI
// - onCancel: (api: ModalAPI) => void
```

---

## ⚠️ 注意事项

1. **必须使用 `as const`**：自定义按钮时，务必使用 `['submit', 'cancel'] as const`，否则 TypeScript 只能推导出 `string[]`，无法生成具体的事件类型。
2. **`destroyOnClose`**：内部已强制开启 `destroyOnClose`，并在 `afterClose` 中自动清理 `options` 和 `buttonMap`，无需手动处理。
3. **`onOk/onCancel` 被接管**：不要传入 `onOk` 或 `onCancel`，请使用动态事件名（如 `onOk` -> `onOk`，`onCancel` -> `onCancel`，自定义按钮 `submit` -> `onSubmit`）。
4. **`childrenRef` 用法**：
   ```tsx
   openModal({
     children: (api) => <UserForm ref={api.childrenRef} />,
     onSubmit: async (api) => {
       const values = await api.childrenRef.current?.validateFields();
       // ...
     },
   });
   ```

---

## 📦 完整类型定义 (`type.d.ts`)

```typescript
import { MutableRefObject, ReactNode } from 'react';
import { ButtonProps, ModalProps } from 'antd';

export interface ButtonAPI {
  buttonProps: ButtonProps;
  setType: (type: ButtonProps['type']) => void;
  setButtonProps: (props: Partial<ButtonProps>) => void;
  setText: (text: ReactNode) => void;
  setLoading: (loading: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  setIsProcessing: (value: boolean) => void;
}

export type ModalAPI<T extends readonly string[] = []> = {
  close: () => void;
  finish: () => void;
  childrenRef: MutableRefObject<any>;
} & {
  [K in T[number] as `${K}Button`]: ButtonAPI;
};

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
```

---

> **版本**: v1.0.0  
> **依赖**: `react >= 18`, `antd >= 5`  
> **维护者**: AI Assistant