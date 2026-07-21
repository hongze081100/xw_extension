
# useControlValue Hook 功能说明文档

## 1. 核心功能

`useControlValue` 是一个专为 React 组件库设计的高性能自定义 Hook，用于优雅地处理组件的**受控（Controlled）**与**非受控（Uncontrolled）**状态管理。

- **自动模式识别**：根据初始化时的 `props` 自动判断组件应处于受控还是非受控模式。
- **状态托管**：
  - **受控模式**：状态完全由外部 `value` 驱动，内部仅作为透传。
  - **非受控模式**：状态由内部 `ref` 维护，外部仅通过 `defaultValue` 初始化。
- **性能优化**：采用 `useRef` 存储状态，配合手动 `forceUpdate`，避免非受控组件在状态变更时产生冗余的渲染周期。

## 2. 设计思路与架构

### 2.1 性能优化：Ref + ForceUpdate
传统实现常使用 `useState` 管理非受控状态，但这会导致每次 `setValue` 都触发完整的 React 渲染流程。本 Hook 采用以下策略：
- 使用 `useRef` 存储 `ControlValueInstance`，确保实例引用稳定，避免 `setValue` 函数引用频繁变化。
- 仅在值发生实质性变化时，调用 `useState({})[1]` 进行手动触发渲染。

### 2.2 闭包安全：onChangeRef
外部传入的 `onChange` 回调可能在每次渲染时都是新引用。为避免在 `createControlValueInstance` 中捕获到过期的闭包，使用 `useRef` 缓存最新的 `onChange`：
```typescript
const onChangeRef = useRef(onChange);
onChangeRef.current = onChange;
```

### 2.3 模式锁定机制
根据需求，组件的受控/非受控模式在**首次渲染时确定**，生命周期内不再切换：
- 使用 `useRef` 记录初始的 `isControlled` 状态。
- 移除了对 `defaultValue` 动态变化的监听，简化了逻辑并提升了性能。

### 2.4 防抖渲染
在 `setValue` 内部增加了 `Object.is` 比较：
```typescript
if (Object.is(inst.value, currentValue)) return;
```
若新旧值相同，直接跳过更新，避免无意义的 `forceUpdate` 和 `onChange` 触发。

## 3. API 接口定义

### 3.1 ControlValueOptions
配置项，用于自定义受控/非受控的 Prop 名称及触发事件。

| 参数 | 说明 | 类型 | 默认值 |
| :--- | :--- | :--- | :--- |
| `defaultValuePropName` | 非受控模式下的默认值属性名 | `string` | `'defaultValue'` |
| `valuePropName` | 受控模式下的值属性名 | `string` | `'value'` |
| `trigger` | 值变更时的回调属性名 | `string` | `'onChange'` |

### 3.2 ControlValueInstance<T>
内部维护的状态实例接口。

| 属性 | 说明 | 类型 |
| :--- | :--- | :--- |
| `value` | 当前状态值 | `T` |
| `setValue` | 更新状态的函数，支持函数式更新 | `(newValue: SetStateAction<T>, ...args: any[]) => void` |

### 3.3 Hook 签名
```typescript
function useControlValue<T = any>(
  props: Record<string, any>,
  options?: ControlValueOptions
): [T, (newValue: SetStateAction<T>, ...args: any[]) => void]
```

## 4. 使用示例

```tsx
import { useControlValue } from './useControlValue';

interface InputProps {
  value?: string;
  defaultValue?: string;
  onChange?: (val: string) => void;
}

const CustomInput: React.FC<InputProps> = (props) => {
  const [value, setValue] = useControlValue<string>(props, {
    valuePropName: 'value',
    defaultValuePropName: 'defaultValue',
    trigger: 'onChange',
  });

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
};
```

## 5. 注意事项

1. **模式不可切换**：本实现不支持组件在生命周期内从受控切换为非受控（或反之）。请确保在组件挂载时即确定使用 `value` 还是 `defaultValue`。
2. **引用稳定性**：返回的 `setValue` 函数引用在整个组件生命周期内保持稳定，可直接用于子组件的 `memo` 依赖或 `useEffect` 依赖。
3. **函数式更新**：`setValue` 完全兼容 React 的函数式更新语法：`setValue(prev => prev + 1)`。
4. **严格模式**：在 React 18 严格模式下，由于 `forceUpdate` 的存在，可能会触发双重执行，但内部状态同步机制保证了 UI 的正确性。