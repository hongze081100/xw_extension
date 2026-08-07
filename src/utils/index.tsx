/**
 * 安全地获取嵌套对象中的属性值
 *
 * 支持点号路径（`a.b.c`）和数组下标（`a[0].b`）两种写法，
 * 路径段可混用。当中间节点为 `null` / `undefined` 时提前返回，
 * 不会抛出 TypeError。
 *
 * @param obj 目标对象
 * @param path 属性路径，如 `'user.profile.name'` 或 `'items[0].title'`
 * @returns 路径对应的值，路径不存在时返回 `undefined`
 *
 * @example
 *   get({ user: { profile: { name: 'Alice' } } }, 'user.profile.name') // 'Alice'
 *   get({ items: [{ title: 'Hi' }] }, 'items[0].title')                 // 'Hi'
 *   get({ a: { b: 1 } }, 'a.c.d')                                      // undefined
 */
export function getValue(obj: unknown, path: string): unknown {
  if (!obj || typeof path !== 'string') return undefined;
  if (!path) return obj;

  // 统一分隔符：点号和括号下标都转换为斜线路径
  // `a.b[0].c` → `a/b/0/c` → `['a','b','0','c']`
  const segments = path
    .replace(/\[(\d+)\]/g, '/$1')
    .replace(/\./g, '/')
    .split('/')
    .filter((seg) => seg !== '');

  let current: any = obj;
  for (const key of segments) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}
