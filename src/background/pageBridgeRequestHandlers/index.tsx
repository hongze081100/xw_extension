import type { ChromeBridgeHandler } from '../ChromeBridge';

export const getTabId: ChromeBridgeHandler = (_args, context) => context.tabId;