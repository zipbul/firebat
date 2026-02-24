// nested-parens: nested parentheses in conditions + string/comment containing 'if'

export function nestedParensCondition(
  a: boolean,
  b: boolean,
  c: boolean,
  d: boolean,
  e: boolean,
): string {
  // if this comment has 'if' it should not count
  const text = 'if (fake) { not real }';

  if ((a && b) || (c && (d || e))) {
    return 'complex';
  }

  if (a || b || c || d || e) {
    return 'many axes';
  }

  return text;
}
