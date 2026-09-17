/**
 * iframe / tab 注入脚本常量
 *
 * 从 content_kd.js Module 987 中提取的内联脚本，
 * 以 template literal 形式导出，供 content script 在运行时
 * 动态注入到 iframe 或目标 tab 中执行。
 *
 * 所有脚本均经过 round-trip 验证：从原始 JS 值 → 本 template literal
 * → eval 还原，结果与原始值完全一致。
 */

/** iframe URL 标识：mtop 代理场景（正则匹配 /guan-iframe/） */
export const GUAN_IFRAME_MARKER = "guan-iframe";

/** iframe URL 标识：fetch 调试场景（精确匹配字符串） */
export const GUAN_IFRAME_FETCH_MARKER = "guan-iframe-fetch-debug=true";

/**
 * mtop iframe 注入脚本
 *
 * 注入时机：iframe URL 匹配 /guan-iframe/ 时，由 content script
 * 通过 Re(..., "text") 创建 <script> 节点追加到 documentElement。
 *
 * 运行环境：被代理的 iframe 页面（与父页面通过 postMessage 通信）。
 *
 * 核心功能：
 *  1. 解析 URL 中的 source 参数（凯撒加密的 script 标签属性），
 *     动态加载 mtop SDK 到 iframe 内；
 *  2. 重写 document.head.appendChild，拦截 h5api.mtop / h5/mtop.*
 *     请求并返回 TIMEOUT stub，同时通过 parent.postMessage 把请求
 *     代理给父页面；
 *  3. 监听父页面发来的 mtop / mtopConfig / setCookies 消息，
 *     在 iframe 内执行真正的 mtop.request() 并把结果 post 回父页面。
 */
export const MTOP_IFRAME_SCRIPT = `
    const callbacks = []
    let initedIntercept = false

    let mtopPromise
    const loadMtop = (jsv) => mtopPromise = new Promise((resolve) => {

      const data = location.search.split(/[?&]/gim).filter(Boolean).reduce((obj, str) => {
        let [key, value] = str.split('=');
        try {
          obj[key] = decodeURIComponent(value);
        } catch(e) {}
        return obj;
      }, {});
      const source = String.fromCharCode(...(data.source || '').split('').map(v => v.charCodeAt(0) - 1));
      data.jsv && source.replace('2.5.8', data.jsv);
      const sourceData = JSON.parse(source || '{}');
      const tag = document.createElement(sourceData.tag);
      for (let key in sourceData) {
        if (key !== 'tag' && !key.includes('_')) {
          tag[key] = sourceData[key];
        }
      }
      document.documentElement.appendChild(tag);
      tag.onload = () => resolve();
    })

    const getMtop = async (jsv = '') => {
      if (window.lib && window.lib.mtop) {
        return window.lib.mtop
      } else {
        await (mtopPromise || loadMtop(jsv))
        return window.lib.mtop
      }
    }

    const getMtopInfo = (url) => {
      return url.replace(/^.*?/, '').split('&').reduce((v1, v2) => {
        let [key, value] = v2.split('=')
        key && (v1[key] = decodeURIComponent(value))
        return v1
      }, {})
    }
    const initIntercept = () => {
      const appendChild = document.head.appendChild.bind(document.head)
      document.head.appendChild = (element) => {
        if (element instanceof HTMLScriptElement) {
          if (/^\\s*(https?\\:)?\\/\\/h5api\\.|\\/h5\\/mtop\\./im.test(element.src)) {
            let src = element.src.replace(/callback=[^\\&]+/im, \`callback=\${callbacks.shift()}\`)
            let mtopInfo = getMtopInfo(src)
            parent.postMessage({
              action: 'mtopRequest',
              src
            }, '*')
            let callback = element.src.match(/callback=([^\\&]+)/im)[1] || ''
            let scrpit = document.createElement('script')
            scrpit.text = \`\${callback}({
              "ret": ["TIMEOUT::接口超时"],
              "retJson": -1
            })\`
            return appendChild(scrpit)
          }
        }
        return appendChild(element)
      }
    }

    window.addEventListener('message', event => {
      const { data } = event
      if (data.action === 'mtop') {
        if (data.callback) {
          callbacks.push(data.callback)
          if (!initedIntercept) {
            initedIntercept = true
            initIntercept()
          }
        }
        getMtop(data.jsv).then(mtop => {
          if (data.config) {
            Object.assign(mtop?.config, data.config)
          }
          mtop.request(data.params).then(result => {
            parent.postMessage({
              action: 'mtopResponse',
              result
            }, '*')
          }, result => {
            parent.postMessage({
              action: 'mtopResponse',
              result
            }, '*')
          })
        })
      } else if (data.action === 'mtopConfig') {
        getMtop(data.jsv).then(mtop => {
          mtop.config = data.config
        })
      } else if (data.action === 'setCookies') {
        const cookies = data.value || [];
        cookies.forEach((cookie) => (document.cookie = cookie));
      }
    }, false)
  `;

/**
 * fetch iframe 注入脚本
 *
 * 注入时机：iframe URL 含 guan-iframe-fetch-debug=true 时，由
 * content script 通过 Re(..., "text") 创建 <script> 节点追加。
 *
 * 运行环境：被代理的 iframe 页面。
 *
 * 核心功能：
 *  1. 监听父页面 action: 'fetch' 消息，在 iframe 内执行 fetch，
 *     将 responseText / headers / status 通过 postMessage 回传；
 *  2. 带 parentTabId 的消息跳过自身，由目标 tab 上的
 *     TAB_FETCH_HANDLER_SCRIPT 处理，避免重复请求；
 *  3. 支持流式 (SSE) 代理：接收 __streamProxy: true 消息，
 *     通过 fetch + ReadableStream 逐 chunk 转发；
 *  4. Aliyun 域名自动注入 SEC_TOKEN 到请求 body；
 *  5. H5 场景下检测 cookie 变更并通过 --set-cookie-- 头回传。
 */
export const FETCH_IFRAME_SCRIPT = `
    // 流式请求中间件存储
    var __guanStreamInflight = new Map();

    window.addEventListener('message', function(event) {
      var data = event.data;
      if (!data) return;

      // ---- 传统非流式请求 ----
      if (data.action === 'fetch' && data.request) {
        // tab 场景（带 parentTabId）由 tabFetch 注入的 ensureFetchHandlerInjected 统一处理，此处跳过避免重复请求
        if (data.parentTabId) return;
        var postMessage = function(result) {
          if (data.parentTabId) {
            window['__dispatch__']('postMessageTo', {
              tabId: data.parentTabId,
              frameId: data.parentFrameId || 0,
              data: result
            });
          } else {
            parent.postMessage(result, '*');
          }
        };
        var events = data.events || [];
        var onIframeRequests = events
          .filter(function(e) { return e.name === 'onIframeRequest'; })
          .map(function(e) { return eval('false || ' + e.code); });
        onIframeRequests.forEach(function(func) { func(data.request); });
        if (data?.request?.body && location.hostname.includes?.('aliyun.com') && window?.ALIYUN_CONSOLE_CONFIG?.SEC_TOKEN) {
          data.request.body = data.request.body?.replace(/sec_token=[^&]*/gim, \`sec_token=\${window.ALIYUN_CONSOLE_CONFIG?.SEC_TOKEN}\`)
        }

        var url = data.request.url;
        var options = Object.assign({}, data.request);
        delete options.url;
        var originalCookie = document.cookie;
        fetch(url, options).then(function(response) {
          return response.text().then(function(responseText) {
            var headersMap = {};
            response.headers.forEach(function(value, key) {
              headersMap[key.toLocaleLowerCase()] = value;
            });
            if (location.href.includes('/h5/')) {
              var cookieDiff = document.cookie.split(';').filter(function(v) {
                return !originalCookie.includes(v) || v.includes('_m_h5');
              });
              if (cookieDiff[0]) {
                headersMap['--set-cookie--'] = cookieDiff
                  .map(function(v) { return v.replace(/^s*|s*$/gim, '') + ';Path=/;Max-Age=604800'; })
                  .join(',');
              }
            }
            postMessage({
              action: 'fetch',
              uuid: data.uuid,
              success: true,
              response: {
                responseText: responseText,
                status: response.status,
                statusText: response.statusText,
                headers: headersMap
              }
            });
          });
        }).catch(function(error) {
          postMessage({ action: 'fetch', uuid: data.uuid, success: false, error: error });
        });
        return;
      }

      // ---- 流式请求 ----
      if (data.__streamProxy === true) {
        var id = data.id;
        var type = data.type;

        if (type === 'abort') {
          var job = __guanStreamInflight.get(id);
          if (job && job.reader) {
            try { job.reader.cancel(data.reason); } catch (_) {}
          }
          __guanStreamInflight.delete(id);
          return;
        }

        if (type !== 'start') return;

        var to = data.to;
        var req = data.req || {};
        var streamEvents = data.events || [];

        // 执行 onIframeRequest 事件钩子
        try {
          var onIframeStreamRequests = streamEvents
            .filter(function(e) { return e.name === 'onIframeRequest'; })
            .map(function(e) { return eval('false || ' + e.code); });
          onIframeStreamRequests.forEach(function(func) {
            func({ url: to, method: req.method, headers: req.headers, body: req.body });
          });
        } catch (hookErr) {
          console.warn('[Guan injectIframe] onIframeRequest 执行出错:', hookErr);
        }

        if (location.hostname.includes('aliyun.com') && window.ALIYUN_CONSOLE_CONFIG?.SEC_TOKEN) {
          req.body = req.body?.replace(/sec_token=[^&]*/gim, \`sec_token=\${window.ALIYUN_CONSOLE_CONFIG?.SEC_TOKEN}\`)
        }

        var sendToParent = function(message) {
          parent.postMessage(Object.assign({ __streamProxy: true }, message), '*');
        };

        (async function() {
          try {
            var headers = new Headers(req.headers || []);
            var res = await fetch(to, {
              method: req.method || 'GET',
              headers: headers,
              body: req.body != null ? req.body : undefined,
              credentials: req.credentials || 'same-origin',
            });

            sendToParent({
              id: id,
              type: 'meta',
              meta: {
                status: res.status,
                statusText: res.statusText,
                headers: Array.from(res.headers.entries()),
              }
            });

            if (!res.body) {
              sendToParent({ id: id, type: 'end' });
              return;
            }

            var reader = res.body.getReader();
            __guanStreamInflight.set(id, { reader: reader });

            while (true) {
              var result = await reader.read();
              if (result.done) break;
              sendToParent({ id: id, type: 'chunk', chunk: result.value });
            }

            sendToParent({ id: id, type: 'end' });
            __guanStreamInflight.delete(id);
          } catch (e) {
            sendToParent({ id: id, type: 'error', error: String(e && e.message ? e.message : e) });
            __guanStreamInflight.delete(id);
          }
        })();
      }
    }, false);
    `;

/**
 * Tab 流式 (SSE) 代理脚本
 *
 * 注入时机：需要跨 tab 代理流式请求时，由 content script 通过
 * executeScriptInMain 注入到目标 tab 的主页面（非 iframe）。
 *
 * 运行环境：目标 tab 主页面。
 *
 * 核心功能：
 *  1. 监听 __streamProxy: true 消息，在当前 tab 内执行 fetch +
 *     ReadableStream，把 meta / chunk / end / error 通过
 *     Guan.DispatchPageAction.Send CustomEvent 发回源 tab；
 *  2. 支持 abort 取消、Aliyun SEC_TOKEN 注入、onIframeRequest 钩子；
 *  3. __GUAN_FORCE_FLAG__ 占位符控制是否跳过重复注入：
 *     替换为 "true" 时强制执行（ignore ready flag），
 *     替换为 "false" 时已就绪则跳过。
 *
 * @see injectForceFlag 替换占位符的辅助函数
 */
export const TAB_STREAM_PROXY_SCRIPT = `
(function() {
  if (window.__GuanStreamProxyReady && !__GUAN_FORCE_FLAG__) return;
  
  var inflight = new Map();
  
  window.addEventListener("message", async function(ev) {
    var msg = ev.data;
    if (!msg || msg.__streamProxy !== true) return;
    var id = msg.id, type = msg.type, parentTabId = msg.parentTabId, parentFrameId = msg.parentFrameId;
    
    if (type === "abort") {
      var job = inflight.get(id);
      try { if (job && job.reader) job.reader.cancel(msg.reason); } catch (_) {}
      inflight.delete(id);
      return;
    }
    
    if (type !== "start") return;
    
    var to = msg.to, req = msg.req || {}, events = msg.events || [];
    
    var sendToParent = function(message) {
      window.dispatchEvent(new CustomEvent('Guan.DispatchPageAction.Send', {
        detail: {
          actionId: Math.random().toString(16),
          action: 'postMessageTo',
          params: {
            tabId: parentTabId,
            frameId: parentFrameId || 0,
            data: Object.assign({ __streamProxy: true }, message)
          }
        }
      }));
    };
    
    try {
      var onIframeRequests = events
        .filter(function(e) { return e.name === 'onIframeRequest'; })
        .map(function(e) { return eval('false || ' + e.code); });
      onIframeRequests.forEach(function(func) { func(req); });
    } catch (hookErr) {}

    if (location.hostname.includes('aliyun.com') && window.ALIYUN_CONSOLE_CONFIG?.SEC_TOKEN}) {
      req.body = req.body?.replace(/sec_token=[^&]*/gim, \`sec_token=\${window.ALIYUN_CONSOLE_CONFIG?.SEC_TOKEN}\`)
    }
    
    try {
      var headers = new Headers(req.headers || []);
      var res = await fetch(to, {
        method: req.method || "GET",
        headers: headers,
        body: req.body != null ? req.body : undefined,
        credentials: req.credentials || 'same-origin',
      });
      
      sendToParent({
        id: id,
        type: "meta",
        meta: {
          status: res.status,
          statusText: res.statusText,
          headers: Array.from(res.headers.entries()),
        }
      });
      
      if (!res.body) {
        sendToParent({ id: id, type: "end" });
        return;
      }
      
      var reader = res.body.getReader();
      inflight.set(id, { reader: reader });
      
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        sendToParent({ id: id, type: "chunk", chunk: Array.from(result.value) });
      }
      
      sendToParent({ id: id, type: "end" });
      inflight.delete(id);
    } catch (e) {
      sendToParent({ id: id, type: "error", error: String(e && e.message ? e.message : e) });
      inflight.delete(id);
    }
  });
  
  window.__GuanStreamProxyReady = true;
})();
`;

/**
 * Tab 普通 fetch 代理脚本
 *
 * 注入时机：需要跨 tab 代理非流式 fetch 请求时，由 content script
 * 通过 executeScriptInMain 注入到目标 tab 的主页面。
 *
 * 运行环境：目标 tab 主页面。
 *
 * 核心功能：
 *  1. 监听 action: 'fetch' 消息，在当前 tab 内执行 fetch，
 *     把 responseText / headers / status 通过
 *     Guan.DispatchPageAction.Send CustomEvent 发回源 tab；
 *  2. 支持 onIframeRequest 钩子、Aliyun SEC_TOKEN 注入、
 *     H5 场景 cookie 差异检测；
 *  3. __GUAN_FORCE_FLAG__ 占位符控制是否跳过重复注入
 *     （同 TAB_STREAM_PROXY_SCRIPT）。
 *
 * @see injectForceFlag 替换占位符的辅助函数
 */
export const TAB_FETCH_HANDLER_SCRIPT = `
(function() {
  if (window.__GuanFetchHandlerReady && !__GUAN_FORCE_FLAG__) return;
  window.addEventListener("message", function(ev) {
    var data = ev.data;
    if (!data || data.action !== 'fetch' || !data.request) return;
    var parentTabId = data.parentTabId;
    var parentFrameId = data.parentFrameId || 0;
    var sendBack = function(result) {
      if (parentTabId == null) return;
      window.dispatchEvent(new CustomEvent('Guan.DispatchPageAction.Send', {
        detail: { actionId: Math.random().toString(16), action: 'postMessageTo',
          params: { tabId: parentTabId, frameId: parentFrameId, data: result } }
      }));
    };
    var events = data.events || [];
    try {
      var onIframeRequests = events.filter(function(e) { return e.name === 'onIframeRequest'; }).map(function(e) { return eval('false || ' + e.code); });
      onIframeRequests.forEach(function(func) { func(data.request); });
    } catch (_) {}
    if (data.request && data.request.body && location.hostname.indexOf('aliyun.com') !== -1 && window.ALIYUN_CONSOLE_CONFIG && window.ALIYUN_CONSOLE_CONFIG.SEC_TOKEN) {
      data.request.body = data.request.body.replace(/sec_token=[^&]*/gim, 'sec_token=' + window.ALIYUN_CONSOLE_CONFIG.SEC_TOKEN);
    }
    var url = data.request.url;
    var options = Object.assign({}, data.request);
    delete options.url;
    var originalCookie = document.cookie;
    fetch(url, options).then(function(response) {
      return response.text().then(function(responseText) {
        var headersMap = {};
        response.headers.forEach(function(value, key) { headersMap[key.toLowerCase()] = value; });
        if (location.href.indexOf('/h5/') !== -1) {
          var cookieDiff = document.cookie.split(';').filter(function(v) {
            return originalCookie.indexOf(v) === -1 || v.indexOf('_m_h5') !== -1;
          });
          if (cookieDiff[0]) {
            headersMap['--set-cookie--'] = cookieDiff.map(function(v) { return v.replace(/^\\s*|\\s*$/gim, '') + ';Path=/;Max-Age=604800'; }).join(',');
          }
        }
        sendBack({ action: 'fetch', uuid: data.uuid, success: true, response: { responseText: responseText, status: response.status, statusText: response.statusText, headers: headersMap } });
      });
    }).catch(function(error) {
      sendBack({ action: 'fetch', uuid: data.uuid, success: false, error: String(error && error.message ? error.message : error) });
    });
  }, false);
  window.__GuanFetchHandlerReady = true;
})();
`;

/**
 * 替换 tab 级脚本中的 __GUAN_FORCE_FLAG__ 占位符
 *
 * TAB_STREAM_PROXY_SCRIPT / TAB_FETCH_HANDLER_SCRIPT 中用占位符
 * 代替原始代码的 ${n}（n = t ? "true" : "false"），调用前需替换。
 *
 * @param script TAB_STREAM_PROXY_SCRIPT 或 TAB_FETCH_HANDLER_SCRIPT
 * @param force  true = 强制注入（忽略 ready flag），false = 已就绪则跳过
 */
export function injectForceFlag(script: string, force: boolean): string {
  return script.replace("__GUAN_FORCE_FLAG__", force ? "true" : "false");
}
