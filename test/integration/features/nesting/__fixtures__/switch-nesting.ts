export function handleEvent(type: string, payload: unknown): string {
  if (type === 'user') {
    switch (type) {
      case 'user':
        if (payload !== null) {
          return 'handled user with payload';
        }

        return 'handled user';
      default:
        return 'unknown user event';
    }
  }

  return 'unhandled';
}
