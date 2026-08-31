import { 
  handlePageActionRequest, 
  handleBackgroundActionResponse
 } from './bridge';
import { PAGE_ACTION_REQUEST_EVENT, BACKGROUND_ACTION_RESPONSE_EVENT } from './bridge/constants';
import type { BridgeRequest, BridgeResponse } from './bridge/types';

/**
 * chrome.runtime.onMessage 监听器：分发页面请求与页面响应。
 * 返回 true 保留消息通道（本实现通过 executeScript 回执，未使用 sendResponse）。
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === PAGE_ACTION_REQUEST_EVENT) {
    handlePageActionRequest(message as BridgeRequest, sender);
    return true;
  }
  if (message?.type === BACKGROUND_ACTION_RESPONSE_EVENT) {
    handleBackgroundActionResponse(message as BridgeResponse);
    return true;
  }
  return true;
});
 