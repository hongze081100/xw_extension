console.info('contentScript is running')
import { createReactMounter } from '@/utils/mouter';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';

import Home from './modules/Home';

dayjs.locale('zh-cn');

const COLOR_PRIMARY = '#1677ff';

const mounter = createReactMounter({
  routes: [
    {
      path: () => true,
      priority: Number.MAX_SAFE_INTEGER,
      mounts: [
        {
          key: 'global',
          select: () => document.body,
          component: Home,
        },
      ],
    }
  ],
  debounceDelay: 150,
  addProvider: (element) => {
    return (
      <>
        <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: COLOR_PRIMARY, colorInfo: COLOR_PRIMARY, zIndexPopupBase: 1000001 } }}>
          <App>{element}</App>
        </ConfigProvider>
      </>
    );
  },
});

mounter.start();