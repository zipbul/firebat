export const getId = (map: Map<string, number>, key: string): number => {
  return map.get(key)!;
};
