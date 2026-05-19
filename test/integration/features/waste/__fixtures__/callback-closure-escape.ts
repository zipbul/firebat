// KEEP boundary (case 6의 반례): 변수가 callback closure 내부 push로 escape
// 'log'는 외부 emitter에 등록된 callback이 capture → callback 실행 시 push가 일어남.
// 변수 자체는 함수 body 내에서 push 외 직접 read가 없지만 closure escape가 use.

type Emitter = { on: (event: string, fn: (e: string) => void) => void };

declare const emitter: Emitter;

export function startLogging(): void {
  const log: string[] = [];

  emitter.on('event', e => log.push(e));
}
