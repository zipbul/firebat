// KEEP (FP-B1): `@ts-expect-error` directly above the declaration makes its type
// error load-bearing. Removing the binding leaves the directive unused (new error).
interface Strict { id: number }
// @ts-expect-error url is not a valid Strict member
const bad: Strict = { url: 'x' };
void bad;
