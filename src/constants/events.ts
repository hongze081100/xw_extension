export const EVENT_PREFIX = '_dispatch_';
const eventName = (name: string) =>  `${EVENT_PREFIX}_${name}`;

export const PAGE_REQUEST_EVENT = eventName("page_request");
export const PAGE_RESPONSE_EVENT = eventName("page_response");
export const BACKGROUND_REQUEST_EVENT = eventName("background_request");
export const BACKGROUND_RESPONSE_EVENT = eventName("background_response");
