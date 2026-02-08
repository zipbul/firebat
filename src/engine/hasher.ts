const initHasher = async (): Promise<void> => {
 // No-op: Bun.hash is always available at runtime.
};

const toU64Hex = (value: bigint): string => {
  const unsigned = BigInt.asUintN(64, value);

  return unsigned.toString(16).padStart(16, '0');
};

const hashString = (input: string): string => {
  // Bun.hash.xxHash64 returns bigint.
  return toU64Hex(Bun.hash.xxHash64(input));
};

export { initHasher, hashString };
