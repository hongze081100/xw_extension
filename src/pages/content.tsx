console.info('contentScript is running')
import { createModuleManager } from '@/utils/ModuleManager';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import Home from './modules/Home';
import { installBridge } from './bridge';
import { hook } from '../utils/network/xhr-hook-new';
// import { ensureHooksInstalled, addFetchListener } from '../utils/network';
dayjs.locale('zh-cn');

const COLOR_PRIMARY = '#1677ff';
installBridge();


// export function configEvent(event, eventTarget) {
//   var e = {};
//   for (var attr in event){
//     e[attr] = event[attr];
//   };
//   e.target = e.currentTarget = eventTarget
//   return e;
// }

// function triggerListener(xhr) {
//   var xhrProxy = xhr._proxy
//   // var callback = 'on' + name + '_';
//   // var event = configEvent({type: name}, xhrProxy);
//   // xhrProxy[callback] && xhrProxy[callback](event);
//   var evt;
//   if (typeof(Event) === 'function') {
//     evt = new Event(name, {bubbles: false});
//   } else {
//     // https://stackoverflow.com/questions/27176983/dispatchevent-not-working-in-ie11
//     evt = document.createEvent('Event');
//     evt.initEvent(name, false, true);
//   }
//   getEventTarget(xhr).dispatchEvent(evt);
// }

hook({
  open(method, url, async, user, password) {
    Object.assign(this.meta, { method, url, async, user, password });
    const ret = this.originFunction(method, url, async, user, password);
    return ret;
  },
  setRequestHeader(name, value) {
    this.meta.headers[String(name).toLowerCase()] = value;
    this.originFunction(name, value);
  },
  send(body) {
    console.log('====send', this.meta);
    const ret = this.originFunction(body);
    return ret;
  },
  addEventListener(type, listener) {
    this.meta.eventTarget.addEventListener(type, listener);
  },
  removeEventListener(type, listener) {
    this.meta.eventTarget.removeEventListener(type, listener);
  },
  onreadystatechange: function () {
    if (this.meta.xhr.readyState === 4 && this.meta.xhr.status !== 0) {
      // handleResponse(xhr, xhrProxy);
      this.meta.eventTarget.dispatchEvent(new Event('readystatechange'));
      this.meta.eventTarget.dispatchEvent(new Event('load'));
      this.meta.eventTarget.dispatchEvent(new Event('loadend'));
    } else if (this.meta.xhr.readyState !== 4) {
      // triggerListener(xhr, eventReadyStateChange);
      this.meta.eventTarget.dispatchEvent(new Event('readystatechange'));
    }
    return true;
  },
}, window);

const mounter = createModuleManager({
  routes: [
    {
      path: () => true,
      priority: Number.MAX_SAFE_INTEGER,
      modules: [
        {
          key: 'global',
          target: () => document.body,
          component: Home,
        },
      ],
    }
  ],
  debounceDelay: 150,
  addProvider: (children) => {
    return (
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: COLOR_PRIMARY, colorInfo: COLOR_PRIMARY, zIndexPopupBase: 1000001 } }}>
        <App>
          {children}
        </App>
      </ConfigProvider>
    );
  },
  // onRouteChange() {
  //   console.log('=====route change');
  // },
});
document.addEventListener('DOMContentLoaded', () => {
  console.info('====DOMContentLoaded')
  mounter.start();
});