import { emitter } from './shared';

export function listenNotification(handler: (msg: string) => void): void {
  emitter.on('notification', handler);
}

export function listenUpdate(handler: (data: unknown) => void): void {
  emitter.on('update', handler);
}
