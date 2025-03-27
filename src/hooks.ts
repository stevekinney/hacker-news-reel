import type { RequestInfo, RequestInit } from './types';

/**
 * Hook that runs before a fetch request is made
 * Can modify the request URL and options before sending
 */
export interface BeforeFetchHook {
  (url: RequestInfo, options?: RequestInit): { url: RequestInfo; options: RequestInit | undefined };
}

/**
 * Hook that runs after a successful fetch request
 * Can inspect or modify the response
 */
export interface AfterFetchHook {
  (response: Response): Response | Promise<Response>;
}

/**
 * Hook that runs when an error occurs during fetch
 * Can handle the error or throw a different one
 */
export interface OnErrorHook {
  (error: Error): Error | Promise<Error> | undefined;
}

/**
 * Complete set of hooks that can be registered with the client
 */
export interface ClientHooks {
  /**
   * Runs before each fetch request
   * Can modify the request URL and options
   */
  beforeFetch?: BeforeFetchHook;

  /**
   * Runs after each successful fetch request
   * Can inspect or modify the response
   */
  afterFetch?: AfterFetchHook;

  /**
   * Runs when an error occurs during fetch
   * Can handle the error or throw a different one
   */
  onError?: OnErrorHook;
}

/**
 * Class to manage multiple hooks
 * Allows registering and sequentially running multiple hooks
 */
export class HooksManager {
  private beforeFetchHooks: BeforeFetchHook[] = [];
  private afterFetchHooks: AfterFetchHook[] = [];
  private onErrorHooks: OnErrorHook[] = [];

  /**
   * Register hooks with the manager
   * @param hooks Object containing hook functions
   */
  public register(hooks: ClientHooks): void {
    if (hooks.beforeFetch) {
      this.beforeFetchHooks.push(hooks.beforeFetch);
    }

    if (hooks.afterFetch) {
      this.afterFetchHooks.push(hooks.afterFetch);
    }

    if (hooks.onError) {
      this.onErrorHooks.push(hooks.onError);
    }
  }

  /**
   * Unregister all hooks
   */
  public clear(): void {
    this.beforeFetchHooks = [];
    this.afterFetchHooks = [];
    this.onErrorHooks = [];
  }

  /**
   * Run all registered beforeFetch hooks in sequence
   * @param url The request URL
   * @param options The request options
   * @returns Modified URL and options
   */
  public async runBeforeFetchHooks(
    url: RequestInfo,
    options?: RequestInit,
  ): Promise<{ url: RequestInfo; options: RequestInit | undefined }> {
    let result = { url, options };

    for (const hook of this.beforeFetchHooks) {
      result = hook(result.url, result.options);
    }

    return result;
  }

  /**
   * Run all registered afterFetch hooks in sequence
   * @param response The fetch response
   * @returns Modified response
   */
  public async runAfterFetchHooks(response: Response): Promise<Response> {
    let result = response;

    for (const hook of this.afterFetchHooks) {
      result = await hook(result);
    }

    return result;
  }

  /**
   * Run all registered onError hooks in sequence
   * @param error The error that occurred
   * @returns The possibly modified error
   */
  public async runOnErrorHooks(error: Error): Promise<Error> {
    let currentError = error;

    for (const hook of this.onErrorHooks) {
      try {
        const result = await hook(currentError);
        if (result instanceof Error) {
          currentError = result;
        }
      } catch (e) {
        if (e instanceof Error) {
          currentError = e;
        }
      }
    }

    return currentError;
  }
}
