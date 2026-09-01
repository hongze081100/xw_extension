import EventEmitter from "../EventEmiiter";
import { IEventHandler } from "./types";

export class EventHandler<Event = any> implements IEventHandler<Event> {
  private eventHandlers = new EventEmitter();

  public add(handler: (event: Event) => void): void {
    this.eventHandlers.on('event', handler);
  }

  public remove(listener: (event: Event) => void): void {
    this.eventHandlers.off('event', listener);
  }

  public dispatch(event: Event): void {
    this.eventHandlers.emit('event', event);
  }
}

export default EventHandler;