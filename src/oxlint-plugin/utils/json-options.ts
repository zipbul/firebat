import type { JsonObject, JsonValue } from '../types';

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const toStringList = (value: JsonValue | undefined): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const out: string[] = [];

  for (const item of value) {
    if (typeof item === 'string') {
      out.push(item);
    }
  }

  return out.length > 0 ? out : null;
};

const toStringOrStringList = (value: JsonValue | undefined): string | string[] | null => {
  if (typeof value === 'string') {
    return value;
  }

  return toStringList(value);
};

export { isJsonObject, toStringList, toStringOrStringList };
