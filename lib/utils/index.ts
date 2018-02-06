export function keysOf<T>(arg: T): Array<keyof T> {
  const keys: Array<keyof T> = [];

  for (const key in arg) {
    keys.push(key);
  }

  return keys;
}
