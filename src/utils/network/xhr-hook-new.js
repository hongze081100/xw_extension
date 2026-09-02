 
export var events = ['load', 'loadend', 'timeout', 'error', 'readystatechange', 'abort'];

 

export function configEvent(event, xhrProxy) {
  var e = {};
  for (var attr in event) e[attr] = event[attr];
  // xhrProxy instead
  e.target = e.currentTarget = xhrProxy
  return e;
}

export function hook(proxyObject, win) {
  win = win || window;
  let OriginalXHR = win.XMLHttpRequest;
  let hooking = true;
  function HookXMLHttpRequest() {
    const xhr = new OriginalXHR();
    const meta = { xhr, headers: {}, eventTarget: document.createElement('a') };
    const proxy = new Proxy(xhr, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value === "function") {
          const originFunction = value.bind(xhr);
          if (prop in proxyObject && typeof proxyObject[prop] === "function") {
            return proxyObject[prop].bind({
              meta,
              originFunction,
            });
          }
          return originFunction;
        }
        return value;
      },
      set(target, prop, value) {
        return Reflect.set(target, prop, value,);
      },
    });
    return proxy;
  }

  HookXMLHttpRequest.prototype.constructor = HookXMLHttpRequest;
  win.XMLHttpRequest = HookXMLHttpRequest;
  win.XMLHttpRequest.toString = () => OriginalXHR.toString();
  win.XMLHttpRequest.valueOf = () => OriginalXHR.valueOf();

  const xhrConsts = ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE", "prototype"];
  for (const key of xhrConsts) {
    win.XMLHttpRequest[key] = OriginalXHR[key];
  }

  function unHook() {
    hooking = false;
    if (win.XMLHttpRequest === HookXMLHttpRequest) {
      win.XMLHttpRequest = OriginalXHR;
      HookXMLHttpRequest.prototype.constructor = OriginalXHR;
      OriginalXHR = undefined;
    }
  }

  // Return the real XMLHttpRequest and unHook func
  return { OriginalXHR, unHook  };
}