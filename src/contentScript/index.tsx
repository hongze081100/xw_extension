console.info('contentScript is running')
import { createReactMounter } from '@/utils/mounter';
import { App, Button, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';

dayjs.locale('zh-cn');

const COLOR_PRIMARY = '#1677ff';

console.log('========test========');

const mounter = createReactMounter({
  routes: [
    {
      path: () => true,
      priority: 1,
      mounts: [
        {
          key: 'global',
          select: () => document.body,
          component: () => {
            return <Button onClick={() => {
              console.log('test');
            }}>test</Button>
          }
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