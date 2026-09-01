export interface IEventHandler<Event = any> {
  add: (handler: (event: Event) => void) => void;
  remove: (handler: (event: Event) => void) => void;
  dispatch: (event: Event) => void;
}
