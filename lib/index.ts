import { EventWithArg } from 'typed-event';
import * as cookies from 'browser-cookies';
import { PossiblyWeakMap } from './possibly-weak-map';
import { keysOf } from './utils';
import {
  conformsTo,
  eachItem,
  isArray,
  isString,
  validate,
  ValidationResult,
  Validator
} from 'typed-validation';


const FALLBACK_COOKIE_KEY = '__app_history__';


export function currentPath(): string {
  return window.location.href.substr(window.location.origin.length);
}


export class Navigation {
  constructor(
    public readonly url: string,
    public readonly path: string,
    public readonly query: { [key: string]: string },
    public readonly refs: { [key: string]: any } = {},
    public cancelled: boolean = false
  ) { }

  public static createFromUrl(url: string): Navigation {
    url = encodeURI(url);

    let path: string = '';
    const query: { [key: string]: string } = {};

    if (url.indexOf('?') >= 0) {
      const parts = url.split('?', 2);
      path = parts[0] || '';
      const queryString = parts[1] || '';
      const queryPairs = queryString.split('&');

      for (const queryPair of queryPairs) {
        const splitPair = queryPair.split('=', 2);
        const key = splitPair[0] || '';
        const value = splitPair[1] || '';

        query[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    } else {
      path = url;
    }

    return new Navigation(url, path, query);
  }
}


export interface IHandler<T> {
  // Returns true if the handler has handled the navigation, false otherwise
  route(nav: Navigation, params: T, subpath: string[]): Promise<boolean>;
}


export abstract class BaseRouter<T> {
  protected handlers: IHandler<T>[] = [];

  public path(path: string): Subrouter<T> {
    const subrouter = new Subrouter<T>();

    this.handlers.push(new PathHandler(path, subrouter));

    return subrouter;
  }

  public register(callback: (nav: Navigation, params: T) => void | Promise<void>, options: Partial<ICallbackHandlerOptions> = {}) {
    this.handlers.push(new CallbackHandler<T>(async (nav, params) => {
      const result = callback(nav, params);

      if (result) {
        await result;
      }
    }, options));
  }

  public param<U>(validator: Validator<U>): Subrouter<T & U> {
    const subrouter = new Subrouter<T & U>();

    this.handlers.push(new ParamHandler(validator, subrouter));

    return subrouter;
  }

  public multiparam<U>(validator: ArrayValidator<U>): Subrouter<T & U> {
    const subrouter = new Subrouter<T & U>();

    this.handlers.push(new MultiParamHandler(validator, subrouter));

    return subrouter;
  }
}


class PathHandler<T> implements IHandler<T> {
  private readonly pathComponents: string[];

  constructor(path: string, private readonly next: IHandler<T>) {
    this.pathComponents = path.split('/').filter(component => component.length !== 0);
  }

  public async route(nav: Navigation, params: T, subpath: string[]): Promise<boolean> {
    if (subpath.length < this.pathComponents.length) {
      return false;
    }

    for (let i = 0; i < this.pathComponents.length; i++) {
      if (subpath[i] !== this.pathComponents[i]) {
        return false;
      }
    }

    return this.next.route(nav, params, subpath.slice(this.pathComponents.length));
  }
}


abstract class BaseParamHandler<T,U> implements IHandler<T> {
  protected readonly key: keyof U;

  constructor(
    validator: Validator<U>,
    private readonly next: IHandler<T & U>
  ) {
    const keys = keysOf(validator);

    if (keys.length !== 1) {
      throw new Error(`Expected one validator, got ${keys.length}`);
    }

    this.key = keys[0];
  }

  public async route(nav: Navigation, params: T, subpath: string[]): Promise<boolean> {
    if (subpath.length === 0) {
      return false;
    }

    const {result, newSubpath} = this.validate(subpath);

    if (!result.success) {
      return false;
    }

    return await this.next.route(nav, Object.assign({}, params, result.value), newSubpath);
  }

  protected abstract validate(subpath: string[]): {result: ValidationResult<U>, newSubpath: string[]};
}


class ParamHandler<T,U> extends BaseParamHandler<T,U> {
  private readonly validator: Validator<U>;
  constructor(
    validator: Validator<U>,
    next: IHandler<T & U>
  ) {
    super(validator, next);
    this.validator =  validator
  }

  protected validate(subpath: string[]): {result: ValidationResult<U>, newSubpath: string[]} {
    const obj: any = {};
    obj[this.key] = subpath[0];
    return {
      result: validate(obj, conformsTo(this.validator)),
      newSubpath: subpath.slice(1)
    };
  }
}


export type ArrayValidator<T> = {
  [K in keyof T]: (arg: Array<string>) => ValidationResult<T[K]>;
};


class MultiParamHandler<T,U> extends BaseParamHandler<T,U> {
  private readonly validator: Validator<U>;
  constructor(
    arrayValidator: ArrayValidator<U>,
    next: IHandler<T & U>
  ) {
    super(arrayValidator, next);

    const validator: any = {};
    validator[this.key] = isArray(eachItem(isString(), arrayValidator[this.key]));
    this.validator = validator as Validator<U>;
  }

  protected validate(subpath: string[]): {result: ValidationResult<U>, newSubpath: string[]} {
    const obj: any = {};
    obj[this.key] = subpath;
    return {
      result: validate(obj, conformsTo(this.validator)),
      newSubpath: []
    };
  }
}


export class Subrouter<T> extends BaseRouter<T> implements IHandler<T> {
  public async route(nav: Navigation, params: T, subpath: string[]): Promise<boolean> {
    for (const handler of this.handlers) {
      if (await handler.route(nav, params, subpath)) {
        return true;
      }
    }

    return false;
  }
}


export interface ICallbackHandlerOptions {
  ignoreAdditionalPath: boolean;
}


class CallbackHandler<T> implements IHandler<T> {
  private readonly callback: (nav: Navigation, params: T) => Promise<void>;
  private readonly options: ICallbackHandlerOptions;
  constructor(
    callback: (nav: Navigation, params: T) => Promise<void>,
    options: Partial<ICallbackHandlerOptions>
  ) {
    this.callback = callback;
    this.options = {
      ignoreAdditionalPath: false,
      ...options
    };
  }

  public async route(nav: Navigation, params: T, subpath: string[]): Promise<boolean> {
    if (!this.options.ignoreAdditionalPath && subpath.length !== 0) {
      return false;
    }

    await this.callback(nav, params);
    return true;
  }
}



export abstract class BrowserApi {
  public readonly navigatedEvent = new EventWithArg<Navigation>();

  public static create(): BrowserApi {
    if (window.history && typeof window.history.pushState === 'function') {
      return new Html5BrowserApi();
    } else {
      return new FallbackBrowserApi();
    }
  }

  public abstract setUrl(nav: Navigation): void;

  public abstract back(): void;

  public abstract clearHistory(currentNav: Navigation): void;
}


export class Html5BrowserApi extends BrowserApi {
  private prevNavs: PossiblyWeakMap<Navigation> = PossiblyWeakMap.create<Navigation>();

  constructor() {
    super();

    window.onpopstate = (e) => {
      if (typeof e.state.id === 'string') {
        let nav: Navigation | undefined = this.prevNavs.get(e.state.id);

        if (nav !== undefined) {
          this.navigatedEvent.emit(nav);
          return;
        }
      }

      this.navigatedEvent.emit(Navigation.createFromUrl(currentPath()));
    };
  }

  public setUrl(nav: Navigation) {
    let id = this.genId();
    this.prevNavs.set(id, nav);
    window.history.pushState({id}, '', nav.url);
  }

  public back() {
    window.history.back();
  }

  public clearHistory(currentNav: Navigation) {
    this.prevNavs = PossiblyWeakMap.create<Navigation>();
    let id = this.genId();
    this.prevNavs.set(id, currentNav);
    window.history.replaceState({id}, '', currentNav.url);
  }

  private genId(): string {
    let id: string;

    do {
      id = `${Date.now().toFixed()}-${Math.floor(Math.random() * 1000000000).toFixed()}`;
    } while (this.prevNavs.has(id));

    return id;
  }
}


export class FallbackBrowserApi extends BrowserApi {
  public setUrl(nav: Navigation) {
    if (currentPath() !== nav.url) {
      let hist = this.getHistory();

      hist.push(currentPath());

      this.setHistory(hist);

      window.location.href = nav.url;
    }
  }

  public back() {
    let hist = this.getHistory();

    let url = hist.pop();

    if (url !== undefined) {
      this.setHistory(hist);

      window.location.href = url;
    }
  }

  public clearHistory() {
    this.setHistory([]);
  }

  private getHistory(): string[] {
    let histStr: string | null = cookies.get(FALLBACK_COOKIE_KEY),
        hist: string[] = [];

    if (histStr !== null) {
      hist = histStr.split('|');
    }

    return hist;
  }

  private setHistory(hist: string[]) {
    if (hist.length === 0) {
      cookies.erase(FALLBACK_COOKIE_KEY);
    } else {
      cookies.set(FALLBACK_COOKIE_KEY, hist.join('|'));
    }
  }
}


export class Router extends BaseRouter<{}> {
  public readonly navigatedEvent = new EventWithArg<Navigation>();

  private _currentNav: Navigation | null = null;

  private nextNav: Navigation | null = null;

  public get currentNav(): Navigation | null { return this._currentNav; }

  private static _instance: Router | null = null;

  public static get instance(): Router {
    let router: Router;

    if (Router._instance === null) {
      router = Router.create();
      Router._instance = router;
    } else {
      router = Router._instance;
    }

    return router;
  }

  constructor(private browserApi: BrowserApi) {
    super();

    this.browserApi.navigatedEvent.register((nav) => this.navigate(nav));
  }

  public static create(): Router {
    return new Router(BrowserApi.create());
  }

  private setCurrentNav(nav: Navigation) {
    this._currentNav = nav;
    this.navigatedEvent.emit(nav);
  }

  public async navigate(url: Navigation | string): Promise<boolean> {
    if (this.handlers.length === 0) return false;

    if (this.nextNav !== null) {
      this.nextNav.cancelled = true;
    }

    let nav: Navigation;

    if (typeof url === 'string') {
      nav = Navigation.createFromUrl(url);
    } else {
      nav = url;
    }

    this.nextNav = nav;
    let handled = await this.route(nav);
    this.nextNav = null;

    if (handled && !nav.cancelled) {
      this.setCurrentNav(nav);
      this.browserApi.setUrl(nav);
    }

    return handled;
  }

  private async route(nav: Navigation): Promise<boolean> {
    const pathComponents = nav.path.split('/').filter(component => component.length !== 0);

    for (const handler of this.handlers) {
      if (await handler.route(nav, {}, pathComponents)) {
        return true;
      }
    }

    return false;
  }

  public back() {
    this.browserApi.back();
  }

  public clearHistory() {
    if (this.currentNav !== null) {
      this.browserApi.clearHistory(this.currentNav);
    }
  }
}
