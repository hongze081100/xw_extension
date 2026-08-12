import { BACKGROUND_REQUEST_EVENT, PAGE_RESPONSE_EVENT } from '@/constants/events';
import { ChromeBridge, type ChromeBridgeHandler } from './ChromeBridge';
import * as pageBridgeRequestHandlers from './pageBridgeRequestHandlers';

export const pageBridge = new ChromeBridge({
  source: 'page',
  requestEvent: BACKGROUND_REQUEST_EVENT,
  responseEvent: PAGE_RESPONSE_EVENT,
});

for (const [action, handler] of Object.entries(pageBridgeRequestHandlers)) {
  if (typeof handler === 'function') {
    pageBridge.register(action, handler as ChromeBridgeHandler);
  }
}
