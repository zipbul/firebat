// Fixture: switch statement with returns
export function handleAction(action: string): string {
  switch (action) {
    case 'start':
      return 'started';
    case 'stop':
      return 'stopped';
    case 'pause':
      return 'paused';
    default:
      return 'unknown';
  }
}
