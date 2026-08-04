console.info('contentScript is running')
import { createModuleManager } from '@/utils/mouter';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';

import Home from './modules/Home';

dayjs.locale('zh-cn');

const COLOR_PRIMARY = '#1677ff';

const mounter = createModuleManager({
  routes: [
    {
      path: () => true,
      priority: Number.MAX_SAFE_INTEGER,
      modules: [
        {
          key: 'global',
          select: () => document.body,
          component: (props: any) => (
            <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: COLOR_PRIMARY, colorInfo: COLOR_PRIMARY, zIndexPopupBase: 1000001 } }}>
              <App>
                <Home {...props} />
              </App>
            </ConfigProvider>
          ),
        },
      ],
    }
  ],
  debounceDelay: 150,
  onRouteChange() {
    console.log('=====route change');
  },
});

mounter.start();