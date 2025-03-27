import type Bottleneck from 'bottleneck';
import type { ClientHooks } from './hooks';

/**
 * An interface representing the Fetch API.
 * This is a global interface that provides an easy way to make network requests.
 */
export type FetchType = typeof fetch;
export type FetchParameters = Parameters<FetchType>;
export type RequestInfo = FetchParameters[0];
export type RequestInit = FetchParameters[1];

/**
 * Represents a unique identifier for a Hacker News item.
 */
export type HackerNewsId = number;

/**
 * Represents a Hacker New user identifier.
 */
export type HackerNewsUsername = string;

/**
 * Represents a list of Hacker News item identifiers.
 */
export type HackerNewsIdList = HackerNewsId[];

/**
 * Represents the type of a Hacker News item.
 * Can be one of 'job', 'story', 'comment', 'poll', or 'pollopt'.
 */
export type HackerNewsItemType = 'job' | 'story' | 'comment' | 'poll' | 'pollopt';

/**
 * Represents an item on Hacker News.
 */
export type HackerNewsItem = {
  /** The item's unique id. */
  id: number;
  /** True if the item is deleted. */
  deleted?: boolean;
  /** The type of item. */
  type?: HackerNewsItemType;
  /** The username of the item's author. */
  by?: string;
  /** Creation date of the item, in Unix time. */
  time?: number;
  /** The comment, story or poll text (HTML). */
  text?: string;
  /** True if the item is dead. */
  dead?: boolean;
  /** The comment's parent id: either another comment or the related story. */
  parent?: number;
  /** For pollopts, the associated poll id. */
  poll?: number;
  /** The ids of the item's comments, in ranked display order. */
  kids?: number[];
  /** The URL of the story. */
  url?: string;
  /** The story's score, or the votes for a pollopt. */
  score?: number;
  /** The title of the story, poll or job (HTML). */
  title?: string;
  /** A list of related pollopts, in display order. */
  parts?: number[];
  /** In the case of stories or polls, the total comment count. */
  descendants?: number;
};

/**
 * Represents a comment with its replies nested.
 * Used in comment trees.
 */
export type HackerNewsCommentTree = HackerNewsItem & {
  /** Nested replies to this comment */
  replies?: HackerNewsCommentTree[];
};

/**
 * Represents a user on Hacker News.
 */
export type HackerNewsUser = {
  /** The user's unique username. Case-sensitive. */
  id: string;
  /** Creation date of the user, in Unix Time. */
  created: number;
  /** The user's karma. */
  karma: number;
  /** The user's optional self-description (HTML). */
  about?: string;
  /** List of the user's stories, polls, and comments. */
  submitted?: number[];
};

/**
 * Represents recent updates on Hacker News.
 */
export type HackerNewsUpdates = {
  /** List of recent changes to the item. */
  items: HackerNewsIdList;
  /** List of recent changes to the user. */
  profiles: HackerNewsUsername[];
};

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /** Max age in milliseconds for fresh data */
  maxAge: number;
  /** Max age in milliseconds for stale data */
  staleWhileRevalidate: number;
  /** Maximum number of entries to keep in cache before LRU eviction */
  maxEntries?: number;
}

/**
 * Configuration options for the retry mechanism
 */
export interface RetryOptions {
  /**
   * The maximum number of retry attempts (default: 3)
   */
  maxRetries?: number;

  /**
   * Initial backoff time in milliseconds (default: 300)
   */
  initialBackoff?: number;

  /**
   * Maximum backoff time in milliseconds (default: 10000)
   */
  maxBackoff?: number;

  /**
   * Jitter factor to add randomness to backoff times (0-1, default: 0.2)
   */
  jitter?: number;

  /**
   * HTTP status codes that should trigger a retry (default: [429, 500, 502, 503, 504])
   */
  retryableStatusCodes?: number[];

  /**
   * Whether to retry on network errors (default: true)
   */
  retryNetworkErrors?: boolean;

  /**
   * The multiplier for exponential backoff (default: 2)
   */
  backoffFactor?: number;
}

/**
 * Options for configuring the Hacker News client
 */

export interface ClientOptions {
  /**
   * Optional fetch function implementation to use instead of global fetch
   * Useful for environments like Deno, node-undici, polyfills, or testing
   */
  fetch?: typeof fetch;

  /**
   * Options for the retry mechanism
   * Set to false to disable retries, or provide a configuration object
   */
  retry?: RetryOptions | false;

  /**
   * Options for Bottleneck rate limiting
   * Set to false to disable rate limiting, or provide a configuration object
   */
  limiter?: Bottleneck.ConstructorOptions | false;

  /**
   * AbortSignal to abort fetch requests
   * Useful for cancelling requests when users navigate away or timeout
   */
  signal?: AbortSignal;

  /**
   * Hooks to customize client behavior
   * Allows executing code before/after requests or on errors
   */
  hooks?: ClientHooks;
}
