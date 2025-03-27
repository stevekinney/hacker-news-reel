/**
 * Cache entry with data and timestamps
 */
interface CacheEntry<T> {
  /** The cached data */
  data: T;
  /** When the data was cached */
  timestamp: number;
  /** When the data was last accessed (for LRU tracking) */
  lastAccessed: number;
}

/**
 * Configuration options for the cache
 */
interface CacheOptions {
  /** Maximum age in ms for fresh data */
  maxAge: number;
  /** Maximum age in ms for stale data */
  staleWhileRevalidate: number;
  /** Maximum number of entries before LRU eviction */
  maxEntries?: number;
}

/**
 * In-memory cache with stale-while-revalidate semantics.
 * - Returns fresh data if within maxAge
 * - Returns stale data if within staleWhileRevalidate while refreshing in the background
 * - Fetches new data if beyond staleWhileRevalidate
 */
export class Cache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private options: CacheOptions;
  private fetchPromises: Map<string, Promise<T>> = new Map();

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      maxAge: 60 * 1000, // 1 minute default
      staleWhileRevalidate: 5 * 60 * 1000, // 5 minutes default
      maxEntries: 1000, // Default max entries to prevent memory leaks
      ...options,
    };
  }

  /**
   * Evict the least recently used entries if we exceed the maximum size
   */
  private evictLRUIfNeeded(): void {
    const { maxEntries } = this.options;

    // Skip if maxEntries is not set or we haven't exceeded it
    if (!maxEntries || this.cache.size <= maxEntries) return;

    // Calculate how many entries to remove
    const entriesToRemove = this.cache.size - maxEntries;

    // Get all entries and sort by lastAccessed (oldest first)
    const entries = Array.from(this.cache.entries())
      .map(([key, value]) => ({
        key,
        // Use timestamp as fallback for backward compatibility with existing cache entries
        lastAccessed: value.lastAccessed !== undefined ? value.lastAccessed : value.timestamp,
      }))
      .sort((a, b) => a.lastAccessed - b.lastAccessed);

    // Remove the oldest entries (we're already checking i < entries.length above)
    entries.slice(0, entriesToRemove).forEach((entry) => {
      this.cache.delete(entry.key);
    });
  }

  /**
   * Get an item from the cache or fetch it
   * @param key Cache key
   * @param fetchFn Function to fetch the data if not in cache
   * @returns The cached or newly fetched data
   */
  async get(key: string, fetchFn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cachedEntry = this.cache.get(key);

    // If data is fresh (within maxAge), update last accessed time and return immediately
    if (cachedEntry && now - cachedEntry.timestamp < this.options.maxAge) {
      // Update last accessed time without changing timestamp
      this.cache.set(key, {
        ...cachedEntry,
        lastAccessed: now,
      });
      return cachedEntry.data;
    }

    // If data is stale but still within staleWhileRevalidate window, return it but refresh in background
    if (cachedEntry && now - cachedEntry.timestamp < this.options.staleWhileRevalidate) {
      // Refresh in background without blocking
      this.refreshInBackground(key, fetchFn);

      // Update last accessed time without changing timestamp
      this.cache.set(key, {
        ...cachedEntry,
        lastAccessed: now,
      });

      // Return stale data immediately
      return cachedEntry.data;
    }

    // If a fetch is already in progress, return pending promise
    if (this.fetchPromises.has(key)) {
      const promise = this.fetchPromises.get(key);
      if (promise) return promise;
    }

    // Otherwise fetch new data and block until it's available
    return this.fetchAndCache(key, fetchFn);
  }

  /**
   * Force a refresh of the cached item
   * @param key Cache key
   * @param fetchFn Function to fetch the data
   * @returns The newly fetched data
   */
  async refresh(key: string, fetchFn: () => Promise<T>): Promise<T> {
    return this.fetchAndCache(key, fetchFn);
  }

  /**
   * Clear a specific item from the cache
   * @param key Cache key to clear
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.fetchPromises.delete(key);
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.fetchPromises.clear();
  }

  /**
   * Check if an item exists in the cache
   * @param key Cache key
   * @returns True if the item exists in the cache
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Refresh data in the background without blocking
   */
  private refreshInBackground(key: string, fetchFn: () => Promise<T>): void {
    // Don't await - intentionally running in background
    this.fetchAndCache(key, fetchFn).catch((error) => {
      // Log errors in development but don't crash the application
      if (process.env.NODE_ENV === 'development') {
        console.error(`Background cache refresh failed for key "${key}":`, error);
      }

      // Clean up the pending promise
      this.fetchPromises.delete(key);
    });
  }

  /**
   * Fetch and cache data
   */
  private async fetchAndCache(key: string, fetchFn: () => Promise<T>): Promise<T> {
    const fetchPromise = (async () => {
      try {
        const data = await fetchFn();
        const now = Date.now();

        this.cache.set(key, {
          data,
          timestamp: now,
          lastAccessed: now, // Initialize last accessed time
        });

        // Check if we need to evict older entries
        this.evictLRUIfNeeded();

        return data;
      } finally {
        // Clean up the fetch promise when done
        this.fetchPromises.delete(key);
      }
    })();

    // Store the promise so we don't have duplicate in-flight requests
    this.fetchPromises.set(key, fetchPromise);
    return fetchPromise;
  }
}
