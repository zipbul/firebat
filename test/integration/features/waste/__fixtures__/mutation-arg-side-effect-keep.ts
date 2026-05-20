// case 6 KEEP boundary: mutation argument has a side-effect (call).
// `collected.push(sideEffect())` cannot be simplified to "no-op" — removing the
// push removes the sideEffect() call too. CLAUDE.md "side-effect 횟수·순서 보존".
// classifyUseInWaste falls back to 'real' when an argument contains an impure
// expression (CallExpression / NewExpression / AwaitExpression / YieldExpression /
// UpdateExpression / AssignmentExpression / TaggedTemplateExpression).

declare function sideEffect(): number;

export function track(events: { type: string }[]): number {
  const collected: number[] = [];

  for (const _ of events) {
    collected.push(sideEffect());
  }

  return events.length;
}
