// K — RHS is a bare literal (magic number); the name is the sole information
// carrier (정보보존 예외). Substituting the literal would leave an opaque value.
export function maskFlags(input: number): number {
  const PERMISSION_MASK = 0x3ffc;

  return input & PERMISSION_MASK;
}
