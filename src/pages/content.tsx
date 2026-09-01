console.info('contentScript is running')
import { createModuleManager } from '@/utils/ModuleManager';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import Home from './modules/Home';
import { installBridge } from './bridge';
import { ensureHooksInstalled, addFetchListener } from '../utils/network-hook';
dayjs.locale('zh-cn');

const COLOR_PRIMARY = '#1677ff';
installBridge();
ensureHooksInstalled();

addFetchListener((context) => {
  console.log('=====fetch', context);
});

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