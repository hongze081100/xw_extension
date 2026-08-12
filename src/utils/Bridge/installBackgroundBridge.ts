import { BACKGROUND_REQUEST_EVENT, BACKGROUND_RESPONSE_EVENT } from '@/constants/events';
import { Bridge } from './Bridge';

function installBackgroundBridge(): Bridge {
  return new Bridge({
    requestEvent: BACKGROUND_REQUEST_EVENT,
    responseEvent: BACKGROUND_RESPONSE_EVENT,
    source: 'background',
    mode: 'receiver',
  });
}

export default installBackgroundBridge;
