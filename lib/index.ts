import { EventWithArg } from 'typed-event';
import * as cookies from 'browser-cookies';
import { PossiblyWeakMap } from 'typed-app-router/possibly-weak-map';


const FALLBACK_COOKIE_KEY = '__app_history__';


function currentPath() {
  return window.location.href.substr(window.location.origin.length);
}


export class Navigation {
  public extras: {[key: string]: any} = {};

  constructor(
    public url: string,
    public path: string,
    public params: { [key: string]: string },
    public query: { [key: string]: string },
    public refs: { [key: string]: any } = {},
    public cancelled: boolean = false
  ) { }

  static createFromUrl(url: string): Navigation {
    url = encodeURI(url);

    let path: string = '',
        query: { [key: string]: string } = {};

    if (url.indexOf('?') >= 0) {
      let parts = url.split('?', 2);
      path = parts[0] || '';
      let queryString = parts[1] || '';
      let queryPairs = queryString.split('&');

      for (let queryPair of queryPairs) {
        let splitPair = queryPair.split('=', 2),
            key = splitPair[0] || '',
            value = splitPair[1] || '';

        query[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    } else {
      path = url;
    }

    return new Navigation(url, path, {}, query);
  }

  clone(): Navigation {
    return new Navigation(
      this.url,
      this.path,
      Object.assign(this.params, {}),
      Object.assign(this.query, {}),
      Object.assign(this.refs, {}),
      this.cancelled
    );
  }

  addParams(params: { [key: string]: string }) {
    this.params = Object.assign(this.params, params);
  }
}


export interface IHandler {
  // Returns true if the handler has handled the navigation, false otherwise
  route(nav: Navigation, subpath: string): Promise<boolean>;
}


const paramRegex = /:([a-z0-9_])+/gi;


interface IPatternMatch {
  params: { [key: string]: string } | null;
  newSubpath: string | null;
}


class PatternHandler implements IHandler {
  private keys: string[];
  private regex: RegExp;

  constructor(path: string, private handler: IHandler, last: boolean) {
    let pathRegex = path.replace(/\/*$/, '').replace(/^\/*/, '').replace('*', '.*').replace(paramRegex, '([a-zA-Z0-9\\-]+)');

    this.keys = (path.match(paramRegex) || []).map(key => key.replace(/^:/, ''));
    this.regex = new RegExp(`^/${pathRegex}${last ? '/?$' : ''}`);
  }

  public async route(nav: Navigation, subpath: string): Promise<boolean> {
    let { params, newSubpath } = this.parseParams(subpath);

    if (params !== null && newSubpath !== null) {
      let newNav = nav.clone();

      newNav.addParams(params);

      return await this.handler.route(newNav, newSubpath);
    }

    return false;
  }

  private parseParams(subpath: string): IPatternMatch {
    let match = this.regex.exec(subpath);

    let result: IPatternMatch = {
      params: null,
      newSubpath: null
    };

    if (match !== null) {
      result.params = {};

      for (let i in this.keys) {
        result.params[this.keys[i]] = match[(i + 1) as any];
      }

      result.newSubpath = subpath.substr(match[0].length) || '/';
    }

    return result;
  }
}


class CallbackHandler implements IHandler {
  constructor(private callback: (nav: Navigation) => Promise<void>) { }

  public async route(nav: Navigation, subpath: string): Promise<boolean> {
    await this.callback(nav);
    return true;
  }
}


export class RouterHandler implements IHandler {
  public next: RouterHandler | null = null;

  constructor(private handler: IHandler) { }

  public async route(nav: Navigation, subpath: string): Promise<boolean> {
    if (await this.handler.route(nav, subpath)) {
      return true;
    }

    if (this.next !== null) {
      return await this.next.route(nav, subpath);
    }

    return false;
  }
}


export abstract class BaseRouter {
  protected rootRouterHandler: RouterHandler | null = null;

  protected lastRouterHandler: RouterHandler | null = null;

  public register(path: string, handler: (nav: Navigation) => void) {
    this.registerAsync(path, async (nav) => handler(nav));
  }

  public registerAsync(path: string, handler: (nav: Navigation) => Promise<void>) {
    this.addRouterHandler(
      new RouterHandler(
        new PatternHandler(
          path,
          new CallbackHandler(handler),
          true
        )
      )
    );
  }

  public subroute(path: string): Subrouter {
    let subrouter = new Subrouter();
    this.addRouterHandler(new RouterHandler(new PatternHandler(path, subrouter, false)));
    return subrouter;
  }

  protected addRouterHandler(routerHandler: RouterHandler) {
    if (this.lastRouterHandler !== null) {
      this.lastRouterHandler.next = routerHandler;
    } else {
      this.rootRouterHandler = routerHandler;
    }

    this.lastRouterHandler = routerHandler;
  }
}


export class Subrouter extends BaseRouter implements IHandler {
  public async route(nav: Navigation, subpath: string): Promise<boolean> {
    if (this.rootRouterHandler !== null) {
      return await this.rootRouterHandler.route(nav, subpath);
    } else {
      return false;
    }
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


export class Router extends BaseRouter {
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
    if (this.rootRouterHandler === null) return false;

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
    let handled = await this.rootRouterHandler.route(nav, nav.path);
    this.nextNav = null;

    if (handled && !nav.cancelled) {
      this.setCurrentNav(nav);
      this.browserApi.setUrl(nav);
    }

    return handled;
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
