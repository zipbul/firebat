import { emitter } from './shared';

export function sendNotification(message: string): void {
  emitter.emit('notification', message);
}

export function broadcastUpdate(data: unknown): void {
  emitter.emit('update', data);
}
