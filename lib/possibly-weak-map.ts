export abstract class PossiblyWeakMap<T> {
  static create<T>(strong: boolean = false): PossiblyWeakMap<T> {
    if (!strong) {
      try {
        return new WeakMapWrapper<T>();
      } catch (_) { }
    }

    return new StrongFallbackMap<T>();
  }

  public abstract set(key: string, value: T): void;

  public abstract get(key: string): T | undefined;

  public abstract has(key: string): boolean;

  public abstract delete(key: string): void;
}


class WeakMapWrapper<T> extends PossiblyWeakMap<T> {
  private weakMap = new WeakMap<object,T>();
  private keyMap: {[key: string]: object} = {};

  public set(key: string, value: T) {
    let k = {};

    this.keyMap[key] = k;
    this.weakMap.set(k, value);
  }

  public get(key: string): T | undefined {
    let k = this.keyMap[key];

    if (k === undefined) return undefined;

    return this.weakMap.get(k);
  }

  public has(key: string): boolean {
    let k = this.keyMap[key];

    if (k === undefined) return false;

    return this.weakMap.has(k);
  }

  public delete(key: string) {
    let k = this.keyMap[key];

    if (k === undefined) return;

    this.weakMap.delete(k);
    delete this.keyMap[key];
  }
}


class StrongFallbackMap<T> extends PossiblyWeakMap<T> {
  private map: {[key: string]: T} = {};

  public set(key: string, value: T) {
    this.map[key] = value;
  }

  public get(key: string): T | undefined {
    return this.map[key];
  }

  public has(key: string): boolean {
    return this.map[key] !== undefined;
  }

  public delete(key: string) {
    delete this.map[key];
  }
}
