import Bottleneck from 'bottleneck';
import { Cache } from './cache';
import { HooksManager } from './hooks';
import {
  HackerNewsIdListSchema,
  HackerNewsIdSchema,
  HackerNewsItemSchema,
  HackerNewsUpdatesSchema,
  HackerNewsUserSchema,
} from './schemas';
import type {
  ClientOptions,
  HackerNewsCommentTree,
  HackerNewsId,
  HackerNewsIdList,
  HackerNewsItem,
  HackerNewsUpdates,
  HackerNewsUser,
  HackerNewsUsername,
  RequestInfo,
  RequestInit,
} from './types';
import type { ClientHooks } from './hooks';

import { fetchWithRetry } from './utilities';

const baseUrl = 'https://hacker-news.firebaseio.com/';

/**
 * Cache configuration for different data types with appropriate TTLs
 */

/**
 * Items cache - rarely change after creation
 * - 5 minutes fresh data
 * - 1 hour stale data
 * - 2000 maximum entries
 */
const itemCache = new Cache<HackerNewsItem>({
  maxAge: 5 * 60 * 1000,
  staleWhileRevalidate: 60 * 60 * 1000,
  maxEntries: 2000,
});

/**
 * Lists cache - change frequently
 * - 30 seconds fresh data
 * - 2 minutes stale data
 * - 20 maximum entries (handful of list types)
 */
const listCache = new Cache<HackerNewsIdList>({
  maxAge: 30 * 1000,
  staleWhileRevalidate: 2 * 60 * 1000,
  maxEntries: 20,
});

/**
 * User cache - changes less frequently
 * - 5 minutes fresh data
 * - 30 minutes stale data
 * - 500 maximum entries
 */
const userCache = new Cache<HackerNewsUser>({
  maxAge: 5 * 60 * 1000,
  staleWhileRevalidate: 30 * 60 * 1000,
  maxEntries: 500,
});

/**
 * Updates cache - changes frequently
 * - 30 seconds fresh data
 * - 1 minute stale data
 * - 5 maximum entries
 */
const updatesCache = new Cache<HackerNewsUpdates>({
  maxAge: 30 * 1000,
  staleWhileRevalidate: 60 * 1000,
  maxEntries: 5,
});

/**
 * MaxItem cache - single entry that changes frequently
 * - 30 seconds fresh data
 * - 1 minute stale data
 * - 1 maximum entry
 */
const maxItemCache = new Cache<HackerNewsId>({
  maxAge: 30 * 1000,
  staleWhileRevalidate: 60 * 1000,
  maxEntries: 1,
});

/**
 * Creates a client with configurable fetch implementation
 * @param options Client options including optional fetch function, limiter configuration, and AbortSignal
 * @returns Object containing all HackerNews API methods
 *
 * Example with AbortSignal:
 * ```ts
 * // Create an AbortController to cancel requests when needed
 * const controller = new AbortController();
 * const client = createClient({ signal: controller.signal });
 *
 * // Later, to cancel all in-flight requests:
 * controller.abort();
 * ```
 *
 * Example with custom rate limiting:
 * ```ts
 * // Create a client with custom rate limiting
 * const client = createClient({
 *   limiter: {
 *     maxConcurrent: 10,       // Allow up to 10 concurrent requests
 *     minTime: 100,            // Minimum 100ms between requests
 *     reservoir: 50,           // Allow bursts up to 50 requests
 *     reservoirRefreshAmount: 10,  // Refill 10 tokens at a time
 *     reservoirRefreshInterval: 1000  // Refill every 1 second
 *   }
 * });
 * ```
 */
export const createClient = (options: ClientOptions = {}) => {
  // Use provided fetch function or fall back to global fetch
  const _fetch = options.fetch || fetch;

  // Default limiter options for the Hacker News API
  const defaultLimiterOptions = {
    maxConcurrent: 5, // Default max concurrent requests
    strategy: Bottleneck.strategy.BLOCK, // Default strategy
  };

  // Create a global rate limiter that can be shared across methods
  const globalLimiter = new Bottleneck(
    options.limiter === undefined || options.limiter === null
      ? defaultLimiterOptions // Use defaults if no options provided
      : options.limiter === false
        ? { maxConcurrent: Infinity } // Effectively disable limiting if explicitly set to false
        : { ...defaultLimiterOptions, ...options.limiter }, // Use provided options with defaults
  );

  // Initialize the hooks manager
  const hooksManager = new HooksManager();

  // Register initial hooks if provided
  if (options.hooks) {
    hooksManager.register(options.hooks);
  }

  /**
   * Makes a fetch request using either the custom fetch function or the retry-enabled fetch
   * Applies hooks before and after fetch, plus error handling
   * @param url The URL to fetch
   * @param init Optional request init options
   * @returns A promise that resolves to the response
   */
  const clientFetch = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    // Merge init with the global signal if provided
    const requestInit = options.signal ? { ...init, signal: init?.signal || options.signal } : init;

    try {
      // Run beforeFetch hooks to potentially modify request
      const { url: modifiedUrl, options: modifiedOptions } = await hooksManager.runBeforeFetchHooks(url, requestInit);

      // Make the actual fetch request
      let response: Response;

      // If a custom fetch function was provided (not the default), use it
      if (options.fetch && options.fetch !== globalThis.fetch) {
        response = await _fetch(modifiedUrl, modifiedOptions);
      } else {
        // Otherwise use the retry-enabled fetch
        response = await fetchWithRetry(modifiedUrl, modifiedOptions, options.retry);
      }

      // Run afterFetch hooks
      return await hooksManager.runAfterFetchHooks(response);
    } catch (error) {
      // Run onError hooks
      const processedError = await hooksManager.runOnErrorHooks(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw processedError;
    }
  };

  /**
   * Creates an asynchronous function that fetches a list of Hacker News IDs from a given endpoint.
   * Includes in-memory caching with stale-while-revalidate semantics.
   *
   * @param endpoint - The endpoint URL to fetch the Hacker News ID list from.
   * @returns A factory function for fetching the list of Hacker News IDs.
   */
  const createListEndpoint = (endpoint: string) => async (): Promise<HackerNewsIdList> => {
    const cacheKey = `list:${endpoint}`;

    return listCache.get(cacheKey, async () => {
      const url = new URL(endpoint, baseUrl);
      const response = await clientFetch(url);

      if (!response.ok) {
        throw new Error(`HN API error ${response.status}: Failed to fetch list from ${endpoint}`);
      }

      const content = await response.json();

      return HackerNewsIdListSchema.parse(content);
    });
  };

  /**
   * Fetches a specific Hacker News item by its ID.
   * Uses in-memory cache with stale-while-revalidate semantics.
   */
  const getItem = async (id: HackerNewsId): Promise<HackerNewsItem> => {
    const cacheKey = `item:${id}`;

    return itemCache.get(cacheKey, async () => {
      // Construct the URL for fetching a specific Hacker News item by its ID.
      const url = new URL(`v0/item/${id}.json`, baseUrl);

      // Fetch the item data from the constructed URL.
      const response = await clientFetch(url);

      // Check if the response was successful
      if (!response.ok) {
        throw new Error(`HN API error ${response.status}: Failed to fetch item ${id}`);
      }

      // Parse the JSON response content.
      const content = await response.json();

      // Validate and return the parsed content using the HackerNewsItemSchema.
      return HackerNewsItemSchema.parse(content);
    });
  };

  /**
   * Fetches multiple Hacker News items based on their IDs.
   * Uses the global rate limiter to control concurrent requests.
   *
   * @param ids - An array of Hacker News item IDs to fetch.
   * @returns A promise that resolves with an array of Hacker News items.
   */
  const getItems = async (ids: HackerNewsIdList): Promise<HackerNewsItem[]> => {
    // Use the global limiter for rate limiting
    const limiter = globalLimiter;

    // Map each ID to a scheduled promise
    const promises = ids.map((id) => {
      return limiter.schedule(() => getItem(id));
    });

    // Wait for all scheduled promises to resolve
    return Promise.all(promises);
  };

  const getUser = async (username: HackerNewsUsername): Promise<HackerNewsUser> => {
    const cacheKey = `user:${username}`;

    return userCache.get(cacheKey, async () => {
      // Construct the URL for fetching a specific Hacker News user by their username.
      const url = new URL(`v0/user/${username}.json`, baseUrl);

      // Fetch the user data from the constructed URL.
      const response = await clientFetch(url);

      // Check if the response was successful
      if (!response.ok) {
        throw new Error(`HN API error ${response.status}: Failed to fetch user ${username}`);
      }

      const user = await response.json();

      // Validate and return the parsed content using the HackerNewsUserSchema.
      return HackerNewsUserSchema.parse(user);
    });
  };

  /**
   * Fetches the maximum Hacker News item ID.
   * Uses in-memory cache with stale-while-revalidate semantics.
   *
   * @returns A promise that resolves with the maximum Hacker News item ID.
   */
  const getMaxItemId = async (): Promise<HackerNewsId> => {
    const cacheKey = 'maxitem';

    return maxItemCache.get(cacheKey, async () => {
      const url = new URL('v0/maxitem.json', baseUrl);
      const response = await clientFetch(url);

      if (!response.ok) {
        throw new Error(`HN API error ${response.status}: Failed to fetch max item ID`);
      }

      const content = await response.json();
      return HackerNewsIdSchema.parse(content);
    });
  };

  /**
   * Fetches the latest updates from Hacker News.
   * Uses in-memory cache with stale-while-revalidate semantics.
   *
   * @returns A promise that resolves with the Hacker News updates.
   */
  const getUpdates = async (): Promise<HackerNewsUpdates> => {
    const cacheKey = 'updates';

    return updatesCache.get(cacheKey, async () => {
      const url = new URL('v0/updates.json', baseUrl);
      const response = await clientFetch(url);

      if (!response.ok) {
        throw new Error(`HN API error ${response.status}: Failed to fetch updates`);
      }

      const content = await response.json();
      return HackerNewsUpdatesSchema.parse(content);
    });
  };

  /**
   * Safe default for the maximum depth of comments to fetch
   * Prevents stack overflows with deeply nested comments
   */
  const DEFAULT_MAX_COMMENT_DEPTH = 25;

  /**
   * Recursively fetches an item and all its comments/replies, creating a nested tree structure.
   *
   * @param itemId - The ID of the item (story or comment) to fetch with its comments
   * @param options - Options for fetching the comments
   * @returns A promise that resolves with the item and its nested comments
   */
  const getItemWithComments = async (
    itemId: HackerNewsId,
    options: {
      /** Maximum depth of comments to fetch (default: 25) */
      maxDepth?: number;
      /** Current depth in the recursion (used internally) */
      currentDepth?: number;
      /** Maximum number of concurrent requests per level (default: 5) */
      concurrency?: number;
    } = {},
  ): Promise<HackerNewsCommentTree> => {
    const { maxDepth = DEFAULT_MAX_COMMENT_DEPTH, currentDepth = 0, concurrency = 5 } = options;

    // Get the item
    const item = await getItem(itemId);

    // Base case: no kids or reached max depth
    if (!item.kids || item.kids.length === 0 || currentDepth >= maxDepth) {
      return { ...item, replies: [] };
    }

    // Use the global limiter to restrict concurrent requests
    const limiter = globalLimiter;

    // Recursively fetch all child comments with concurrency limit
    const replies = await Promise.all(
      item.kids.map((kidId) => {
        return limiter.schedule(async () => {
          try {
            return await getItemWithComments(kidId, {
              maxDepth,
              currentDepth: currentDepth + 1,
              concurrency,
            });
          } catch {
            // If a comment fails to load, return a placeholder
            return {
              id: kidId,
              deleted: true,
              type: 'comment' as const,
              text: 'Failed to load comment',
              replies: [],
            };
          }
        });
      }),
    );

    // Filter out deleted or dead comments
    const validReplies = replies.filter((reply) => !reply.deleted && !reply.dead);

    // Return the item with its replies
    return {
      ...item,
      replies: validReplies,
    };
  };

  // Return the client object with all methods
  const client = {
    // Main API methods
    getItem,
    getItems,
    getUser,
    getMaxItemId,
    getUpdates,
    getItemWithComments,

    // Story list methods
    getTopStories: createListEndpoint('v0/topstories.json'),
    getNewStories: createListEndpoint('v0/newstories.json'),
    getBestStories: createListEndpoint('v0/beststories.json'),
    getAskStories: createListEndpoint('v0/askstories.json'),
    getShowStories: createListEndpoint('v0/showstories.json'),
    getJobStories: createListEndpoint('v0/jobstories.json'),

    // Cache control methods
    invalidateItemCache: (id: HackerNewsId): void => {
      itemCache.invalidate(`item:${id}`);
    },
    invalidateUserCache: (username: HackerNewsUsername): void => {
      userCache.invalidate(`user:${username}`);
    },
    invalidateListCaches: (): void => {
      const endpoints = [
        'v0/topstories.json',
        'v0/newstories.json',
        'v0/beststories.json',
        'v0/askstories.json',
        'v0/showstories.json',
        'v0/jobstories.json',
      ];

      endpoints.forEach((endpoint) => {
        listCache.invalidate(`list:${endpoint}`);
      });
    },
    clearAllCaches: (): void => {
      itemCache.clear();
      listCache.clear();
      userCache.clear();
      updatesCache.clear();
      maxItemCache.clear();
    },

    /**
     * Register hooks with the client
     * @param hooks Object with beforeFetch, afterFetch, and/or onError functions
     * @returns The client instance for chaining
     *
     * Example:
     * ```ts
     * client.use({
     *   beforeFetch: (url, opts) => {
     *     console.log(`Fetching ${url}`);
     *     return { url, options: opts };
     *   },
     *   afterFetch: (response) => {
     *     console.log(`Received ${response.status} from ${response.url}`);
     *     return response;
     *   },
     *   onError: (err) => {
     *     console.error(`Error in fetch: ${err.message}`);
     *   }
     * });
     * ```
     */
    use: (hooks: ClientHooks) => {
      hooksManager.register(hooks);
      return client;
    },

    /**
     * Clear all registered hooks
     * @returns The client instance for chaining
     */
    clearHooks: () => {
      hooksManager.clear();
      return client;
    },
  };

  return client;
};

// Create default client for backward compatibility
const defaultClient = createClient();

// Export all methods from the default client for backward compatibility
export const {
  getItem,
  getItems,
  getUser,
  getMaxItemId,
  getUpdates,
  getItemWithComments,
  getTopStories,
  getNewStories,
  getBestStories,
  getAskStories,
  getShowStories,
  getJobStories,
  invalidateItemCache,
  invalidateUserCache,
  invalidateListCaches,
  clearAllCaches,
} = defaultClient;
