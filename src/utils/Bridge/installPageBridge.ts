import { PAGE_REQUEST_EVENT, PAGE_RESPONSE_EVENT } from '@/constants/events';
import { Bridge } from './Bridge';

function installPageBridge(): Bridge {
  return new Bridge({
    requestEvent: PAGE_REQUEST_EVENT,
    responseEvent: PAGE_RESPONSE_EVENT,
    source: 'page',
    mode: 'sender',
  });
}

export default installPageBridge;
