import { EventWithArg } from 'typed-event';


export class Navigation {
  constructor(
    public path: string,
    public params: { [key: string]: string },
    public query: { [key: string]: string },
    public refs: { [key: string]: any } = {},
    public cancelled: boolean = false
  ) { }

  static createFromUrl(url: string): Navigation {
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

    return new Navigation(path, {}, query);
  }

  clone(): Navigation {
    return new Navigation(
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

  public router(path: string): Subrouter {
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


export class Router extends BaseRouter {
  public readonly navigatedEvent = new EventWithArg<Navigation>();

  private _currentNav: Navigation | null = null;

  public get currentNav(): Navigation | null { return this._currentNav; }

  private setCurrentNav(nav: Navigation) {
    this._currentNav = nav;
    this.navigatedEvent.emit(nav);
  }

  private nextNav: Navigation | null = null;

  public async navigate(url: string): Promise<boolean> {
    if (this.rootRouterHandler === null) return false;

    if (this.nextNav !== null) {
      this.nextNav.cancelled = true;
    }

    let nav = Navigation.createFromUrl(url);

    this.nextNav = nav;
    let handled = await this.rootRouterHandler.route(nav, nav.path);
    this.nextNav = null;

    if (handled && !nav.cancelled) {
      this.setCurrentNav(nav);
    }

    return handled;
  }
}
