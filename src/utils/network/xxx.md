
#### iframe-hub.ts

跨域 iframe 请求代理中心。当页面运行在 IP 地址或 localhost 时，需要通过隐藏 iframe 携带真实 cookie 发起跨域请求。

| 导出 | 签名 | 说明 |
|------|------|------|
| `getOrCreateProxy(url)` | `(string) => IframeProxy` | 按域名缓存创建隐藏 iframe |
| `iframeFetch(request, events?, proxy?, isStream?)` | `Promise<Response>` | 通过 iframe 执行 fetch（支持 SSE 流式代理） |
| `createMtopIframe(args)` | `Promise<void>` | 创建 MTOP SDK iframe（淘宝 H5 中间页） |
| `sendMtopRequest(args)` | `void` | 通过 MTOP iframe 发送请求 |
| `cleanupAllIframes()` | `void` | 卸载所有代理 iframe（beforeunload 调用） |

**流式代理原理**：

```
父页面                         隐藏 iframe（同源目标域）
  │                               │
  │── postMessage {type:"start"} ──▶│
  │                               │── fetch(真实 URL)
  │◀── postMessage {type:"meta"} ──│   ├─ 读取响应头，创建 ReadableStream
  │◀── postMessage {type:"chunk"} ─│   ├─ postMessage 传输每段数据
  │◀── postMessage {type:"end"} ───│   └─ 完成
  │                               │
  └─ 组合为完整 Response 返回
```