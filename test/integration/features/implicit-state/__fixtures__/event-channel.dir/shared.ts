interface Emitter {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): void;
}

export const emitter: Emitter = {
  emit(_channel: string, _data: unknown): void {},
  on(_channel: string, _handler: (data: unknown) => void): void {},
};
