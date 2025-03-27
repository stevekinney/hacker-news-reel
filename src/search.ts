import Bottleneck from 'bottleneck';
import { z } from 'zod';
import { Cache } from './cache';
import { RateLimitError } from './errors';
import { HooksManager } from './hooks';
import type { ClientHooks } from './hooks';
import type { ClientOptions, RequestInfo, RequestInit } from './types';
import { fetchWithRetry } from './utilities';

/**
 * Base URL for the Algolia Hacker News API
 */
const baseUrl = 'https://hn.algolia.com/api/v1';

/**
 * Types of content that can be searched for in Hacker News
 */
export type HackerNewsSearchTag =
  | 'story'
  | 'comment'
  | 'poll'
  | 'pollopt'
  | 'show_hn'
  | 'ask_hn'
  | 'front_page'
  | string;

/**
 * Available numeric fields that can be filtered on
 */
export type HackerNewsNumericField = 'created_at_i' | 'points' | 'num_comments';

/**
 * Type of numeric filter operator for search queries
 */
export type NumericFilterOperator = '<' | '<=' | '=' | '>' | '>=';

/**
 * Numeric filter configuration for search queries
 */
export interface NumericFilter {
  field: HackerNewsNumericField;
  operator: NumericFilterOperator;
  value: number;
}

/**
 * Options for the searchStories function
 */
export interface SearchOptions {
  /**
   * Tags to filter search results by
   */
  tags?: HackerNewsSearchTag[];

  /**
   * Numeric filters to apply to search results
   */
  numericFilters?: NumericFilter[];

  /**
   * Page number to return (0-based)
   */
  page?: number;

  /**
   * Number of results per page
   */
  hitsPerPage?: number;

  /**
   * By default, sorts by relevance. Set to true to sort by date.
   */
  sortByDate?: boolean;

  /**
   * Restrict search to specific attributes (e.g., 'url', 'title')
   */
  restrictSearchableAttributes?: string[];

  /**
   * Author username to filter by
   */
  author?: string;

  /**
   * Story ID to filter comments by
   */
  storyId?: number;
}

/**
 * Schema for a search result hit from the Algolia API
 */
const HackerNewsSearchHitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  author: z.string(),
  points: z.number().nullable().optional(),
  story_text: z.string().nullable().optional(),
  comment_text: z.string().nullable().optional(),
  _tags: z.array(z.string()),
  created_at: z.string(),
  created_at_i: z.number(),
  num_comments: z.number().nullable().optional(),
});

/**
 * Schema for Algolia search response
 */
const HackerNewsSearchResponseSchema = z.object({
  hits: z.array(HackerNewsSearchHitSchema),
  page: z.number(),
  nbHits: z.number(),
  nbPages: z.number(),
  hitsPerPage: z.number(),
  processingTimeMS: z.number(),
  query: z.string(),
});

/**
 * Type for a search result hit from the Algolia API
 */
export type HackerNewsSearchHit = z.infer<typeof HackerNewsSearchHitSchema>;

/**
 * Type for the Algolia search response
 */
export type HackerNewsSearchResponse = z.infer<typeof HackerNewsSearchResponseSchema>;

/**
 * Cache for search results
 * - 30 seconds fresh data
 * - 2 minutes stale data
 * - 500 maximum cache entries
 */
const searchCache = new Cache<HackerNewsSearchResponse>({
  maxAge: 30 * 1000,
  staleWhileRevalidate: 2 * 60 * 1000,
  maxEntries: 500,
});

/**
 * Generates a cache key for a search query
 * @param query The search query
 * @param options The search options
 * @returns A string cache key
 */
const generateCacheKey = (query: string, options: SearchOptions): string => {
  return `search:${query}:${JSON.stringify(options)}`;
};

/**
 * Creates a search client with configurable fetch implementation
 * @param options Client options including optional fetch function and AbortSignal
 * @returns Object containing all HackerNews search API methods
 *
 * Example with AbortSignal:
 * ```ts
 * // Create an AbortController to cancel requests when needed
 * const controller = new AbortController();
 * const client = createSearchClient({ signal: controller.signal });
 *
 * // Later, to cancel all in-flight requests:
 * controller.abort();
 * ```
 */
export const createSearchClient = ({
  limiter = {
    minTime: 370, // Minimum time between requests in ms (~2.7 req/sec)
    maxConcurrent: 1, // Process one request at a time for precise rate limiting
    reservoir: 100, // Allow bursts up to 100 requests
    reservoirRefreshAmount: 10, // Refill 10 tokens at a time
    reservoirRefreshInterval: 3700, // Refill every 3.7 seconds (~2.7 req/sec)
  },
  fetch: _fetch = globalThis.fetch,
  retry,
  signal,
  hooks,
}: ClientOptions = {}) => {
  // Initialize the hooks manager
  const hooksManager = new HooksManager();

  // Register initial hooks if provided
  if (hooks) {
    hooksManager.register(hooks);
  }
  /**
   * Rate limiter for Algolia API calls
   * - 2.7 requests per second (10,000/hour quota limit)
   * - Using minTime of 370ms with strict concurrency of 1
   */
  const bottleneck = new Bottleneck(
    limiter === false
      ? { maxConcurrent: Infinity } // Effectively disable limiting
      : limiter,
  );

  /**
   * Makes a fetch request using either the custom fetch function or the retry-enabled fetch
   * Rate limited to prevent exceeding Algolia's rate limits
   * Applies hooks before and after fetch, plus error handling
   * @param url The URL to fetch
   * @param init Optional request init options
   * @returns A promise that resolves to the response
   */
  const clientFetch = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    // Use bottleneck to schedule the fetch call with rate limiting
    return bottleneck.schedule(async () => {
      try {
        // Merge init with the signal if provided
        const requestInit = { ...init };
        if (signal) {
          requestInit.signal = init?.signal || signal;
        }

        // Run beforeFetch hooks to potentially modify request
        const { url: modifiedUrl, options: modifiedOptions } = await hooksManager.runBeforeFetchHooks(url, requestInit);

        // Make the actual fetch request
        let response: Response;

        // If a custom fetch function was provided (not the default), use it
        if (_fetch !== globalThis.fetch) {
          response = await _fetch(modifiedUrl, modifiedOptions);
        } else {
          // Otherwise use the retry-enabled fetch
          response = await fetchWithRetry(modifiedUrl, modifiedOptions, retry);
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
    });
  };

  /**
   * Search for stories, comments, polls, etc. on Hacker News using Algolia's API
   * @param query The search query string
   * @param options Options for filtering and pagination
   * @returns A promise that resolves to the search results
   * @throws RateLimitError If the API rate limit is exceeded after all retries.
   *                       This error contains a retryAfterSeconds property
   *                       with the suggested wait time from the Retry-After header.
   */
  const searchStories = async (query: string, options: SearchOptions = {}): Promise<HackerNewsSearchResponse> => {
    const cacheKey = generateCacheKey(query, options);

    return searchCache.get(cacheKey, async () => {
      const {
        tags = ['story'],
        numericFilters = [],
        page = 0,
        hitsPerPage = 20,
        sortByDate = false,
        restrictSearchableAttributes = [],
        author,
        storyId,
      } = options;

      // Construct the URL
      const endpoint = sortByDate ? 'search_by_date' : 'search';
      const url = new URL(`${baseUrl}/${endpoint}`);

      // Add query parameters
      url.searchParams.append('query', query);

      // Process tags
      const tagsList = [...tags];

      // Add author tag if provided
      if (author) {
        tagsList.push(`author_${author}`);
      }

      // Add story tag if provided
      if (storyId) {
        tagsList.push(`story_${storyId}`);
      }

      // Join tags with comma
      if (tagsList.length > 0) {
        url.searchParams.append('tags', tagsList.join(','));
      }

      // Process numeric filters
      if (numericFilters.length > 0) {
        const filterStrings = numericFilters.map((filter) => `${filter.field}${filter.operator}${filter.value}`);
        url.searchParams.append('numericFilters', filterStrings.join(','));
      }

      // Add pagination
      url.searchParams.append('page', page.toString());
      url.searchParams.append('hitsPerPage', hitsPerPage.toString());

      // Add attribute restriction if provided
      if (restrictSearchableAttributes.length > 0) {
        url.searchParams.append('restrictSearchableAttributes', restrictSearchableAttributes.join(','));
      }

      // Fetch search results with retry capability
      const response = await clientFetch(url.toString());

      if (!response.ok) {
        // If it's a rate limit error, throw a specific error
        if (response.status === 429) {
          throw new RateLimitError(
            `Rate limit exceeded with status code ${response.status}. Check retryAfterSeconds for wait time.`,
            response,
          );
        }

        throw new Error(`Search request failed: ${response.statusText}`);
      }

      const data = await response.json();

      // Validate and return the search results
      return HackerNewsSearchResponseSchema.parse(data);
    });
  };

  /**
   * Fetch the front page stories from Hacker News
   * @param options Additional search options
   * @returns A promise that resolves to the front page stories
   * @throws RateLimitError If the API rate limit is exceeded after all retries.
   *                       This error contains a retryAfterSeconds property
   *                       with the suggested wait time from the Retry-After header.
   */
  const getFrontPageStories = async (options: Omit<SearchOptions, 'tags'> = {}): Promise<HackerNewsSearchResponse> => {
    return searchStories('', {
      ...options,
      tags: ['front_page'],
    });
  };

  // Return the client object with all methods
  const client = {
    searchStories,
    getFrontPageStories,
    invalidateSearchCache: (query: string, options: SearchOptions = {}): void => {
      const cacheKey = generateCacheKey(query, options);
      searchCache.invalidate(cacheKey);
    },
    clearSearchCache: (): void => {
      searchCache.clear();
    },
    /**
     * Register hooks with the search client
     * @param hooks Object with beforeFetch, afterFetch, and/or onError functions
     * @returns The client instance for chaining
     *
     * Example:
     * ```ts
     * searchClient.use({
     *   beforeFetch: (url, opts) => {
     *     console.log(`Searching ${url}`);
     *     return { url, options: opts };
     *   },
     *   afterFetch: (response) => {
     *     console.log(`Search returned ${response.status}`);
     *     return response;
     *   },
     *   onError: (err) => {
     *     console.error(`Error in search: ${err.message}`);
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

// Create default search client for backward compatibility
const defaultSearchClient = createSearchClient();

// Export all methods from the default search client for backward compatibility
export const { searchStories, getFrontPageStories, invalidateSearchCache, clearSearchCache } = defaultSearchClient;
