/**
 * defineEnum 核心类型定义
 */

// ==================== 常量与基础接口 ====================

/** 枚举项的主键查找优先级 */
export const PK = ['key', 'value'] as const;

/** 枚举项 value 允许的原始数据类型 */
export type DefineEnumItemValue = string | number | boolean;

/** 枚举项的基础数据结构 */
export interface DefineEnumItem {
  /** 可选的自定义 key */
  key?: string;
  /** 枚举的唯一标识值 */
  value: DefineEnumItemValue;
  /** 允许扩展任意其他属性 */
  [key: string]: any;
}

// ==================== 类型推导工具 ====================

/** 将包含 `-` 或 `_` 的字符串转换为驼峰命名 */
type CamelNameConverter<T extends string> = T extends `${infer A}${'-' | '_'}${infer B}`
  ? `${CamelNameConverter<A>}${CamelNameConverter<Capitalize<B>>}`
  : `${T}`;

/** 根据主键生成 `isXxx` 方法名 */
export type IsMethodName<T extends string> = `is${Capitalize<
  T extends `${string}${'_' | '-'}${string}`
    ? CamelNameConverter<Lowercase<T>>
    : T extends Uppercase<T>
    ? Lowercase<T>
    : T
>}`;

/** 判断字符串的首字母是否为大写 */
type IsUppercaseCharStartWith<T extends string> = Capitalize<T> extends Uncapitalize<T>
  ? false
  : T extends Capitalize<T>
  ? true
  : false;

/** 将驼峰命名转换为大写下划线常量命名 */
type ConvertConstantName<T extends string> = T extends `${infer F}${infer R}`
  ? [IsUppercaseCharStartWith<F>, IsUppercaseCharStartWith<R>] extends [false, true]
    ? `${F}_${ConvertConstantName<R>}`
    : `${F}${ConvertConstantName<R>}`
  : T;

/** 将 Lodash 风格的命名 (连字符) 转换为下划线命名 */
type LodashConstantName<T extends string> = T extends `${infer F}-${infer R}`
  ? `${F}_${LodashConstantName<R>}`
  : T;

/** 统一的常量命名转换器 */
export type ConstantName<T extends string> = Uppercase<
  T extends `${string}_${string}`
    ? T
    : T extends `${string}-${string}`
    ? LodashConstantName<T>
    : ConvertConstantName<T>
>;

/** 从对象中按优先级提取主键的值 */
type PrimaryKey<T, N> = N extends readonly [infer Name, ...infer Rest]
  ? Name extends keyof T
    ? `${T[Name] & (string | number | boolean)}`
    : PrimaryKey<T, Rest>
  : never;

/** 提取联合类型中所有对象的键 */
type Keys<T> = T extends any ? keyof T : never;

/** 递归查找并返回 `getXxx` 方法的精确返回类型 */
type GetMethodReturnType<
  T extends readonly DefineEnumItem[],
  K extends Keys<U[number]>,
  Arg,
  U extends readonly DefineEnumItem[] = T,
> = U extends readonly [infer F extends { value: any }, ...infer R]
  ? Arg extends F['value']
    ? K extends keyof F
      ? F[K]
      : never
    : GetMethodReturnType<T, K, Arg, R>
  : never;

// ==================== 核心导出类型 ====================

/**
 * defineEnum 函数的最终返回类型
 * 包含：原始数组、大写常量访问、isXxx 判断方法、getXxx 提取方法
 */
export type DefineEnumReturnType<T extends readonly DefineEnumItem[]> = 
  // 1. 保留原始数组的所有能力
  { [P in keyof T]: T[P] } & 
  
  // 2. 大写常量访问 (如 MY_ENUM_ITEM)
  { [O in T[number] as `${ConstantName<PrimaryKey<O, typeof PK>>}`]: O } & 
  
  // 3. isXxx 方法，参数类型精确匹配该枚举项的 value 类型
  { [O in T[number] as IsMethodName<PrimaryKey<O, typeof PK>>]: (value: O['value']) => boolean } & 
  
  // 4. getXxx 方法，fieldName 严格限制为枚举项中存在的键
  { [K in Keys<T[number]> as `get${Capitalize<K & string>}`]: <Arg extends T[number]['value']>(fieldName: K) => GetMethodReturnType<T, K, Arg> };

/** 从返回类型中反推原始枚举数组类型 */
export type DefineEnumSource<T> = T extends DefineEnumReturnType<infer S> ? S : never;

/** 从返回类型中提取所有枚举项的 value 联合类型 */
export type DefineEnumValue<T> = T extends DefineEnumReturnType<infer S>
  ? S extends readonly DefineEnumItem[]
    ? S[number]['value']
    : never
  : never;