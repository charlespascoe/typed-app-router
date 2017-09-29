export interface ICookieOptions {
  expires: number | Date | string;
  domain: string;
  path: string;
  secure: boolean;
  httponly: boolean;
}


export type Partial<T> = {
  [key in keyof T]?: T[key];
};


export interface IEraseCookieOptions {
  domain?: string;
  path?: string;
}

export declare function set(key: string, value: string, options?: Partial<ICookieOptions>): void;

export declare function get(key: string): string | null;

export declare function all(): {[key: string]: string};

export declare function erase(key: string, options?: IEraseCookieOptions): void;

export declare const defaults: ICookieOptions;
