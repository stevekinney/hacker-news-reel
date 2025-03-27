import { RateLimitError } from './errors';
import type { RequestInfo, RequestInit, RetryOptions } from './types';

/**
 * Default retry options for fetch operations
 * - maxRetries: 3 attempts
 * - initialBackoff: 300ms
 * - maxBackoff: 10000ms (10s)
 * - jitter: 20% randomness to prevent request floods
 * - retryableStatusCodes: [429, 500, 502, 503, 504]
 * - retryNetworkErrors: true
 * - backoffFactor: 2 (exponential backoff)
 */
export const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialBackoff: 300,
  maxBackoff: 10000,
  jitter: 0.2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  retryNetworkErrors: true,
  backoffFactor: 2,
};

/**
 * Determines if an error is a network error
 * @param error The error to check
 * @returns True if error is a network-related TypeError
 */
const isNetworkError = (error: unknown): boolean => {
  return (
    error instanceof TypeError &&
    ((error as TypeError).message.includes('Failed to fetch') ||
      (error as TypeError).message.includes('Network request failed'))
  );
};

/**
 * Calculates backoff time with exponential increase and jitter
 * @param attempt Current attempt number (0-based)
 * @param options Retry configuration options
 * @returns Backoff time in milliseconds
 */
export const calculateBackoff = (
  attempt: number,
  { initialBackoff, backoffFactor, maxBackoff, jitter }: Required<RetryOptions>,
): number => {
  // Calculate exponential backoff: initialBackoff * (backoffFactor ^ attempt)
  let backoff = initialBackoff * Math.pow(backoffFactor, attempt);

  // Apply jitter to avoid thundering herd problem
  // Randomly adjust the backoff by ±jitter%
  const randomFactor = 1 - jitter + Math.random() * (2 * jitter);
  backoff = backoff * randomFactor;

  // Enforce maximum backoff
  return Math.min(backoff, maxBackoff);
};

/**
 * Creates a promise that resolves after a specified delay
 * @param ms Time to sleep in milliseconds
 * @returns Promise that resolves after the specified delay
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Fetch with automatic exponential backoff retry for network errors and specified status codes
 * Also supports request cancellation via AbortSignal
 */
export const fetchWithRetry = async (
  input: RequestInfo,
  init?: RequestInit,
  options?: RetryOptions | false,
): Promise<Response> => {
  // Check if request is already aborted
  if (init?.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  // If retry is explicitly disabled, use regular fetch
  if (options === false) {
    return fetch(input, init);
  }

  // Merge provided options with defaults
  const retryOptions: Required<RetryOptions> = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  const { maxRetries, retryableStatusCodes, retryNetworkErrors } = retryOptions;

  // Set up abort event listener to stop retries
  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };

  if (init?.signal) {
    init.signal.addEventListener('abort', onAbort);
  }

  let lastError: unknown;

  // Try the initial request plus the specified number of retries
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Check if the request has been aborted
      if (aborted || init?.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      // Only wait before retries (not before the first attempt)
      if (attempt > 0) {
        // Calculate and wait for the appropriate backoff time
        const backoffTime = calculateBackoff(attempt - 1, retryOptions);
        await sleep(backoffTime);

        // Check again if the request was aborted during sleep
        if (aborted || init?.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
      }

      const response = await fetch(input, init);

      // If response is ok, return it immediately
      if (response.ok) {
        return response;
      }

      // If it's not a retryable status code, throw immediately with a clear error
      if (!retryableStatusCodes.includes(response.status)) {
        throw new Error(`Request failed with status ${response.status}: ${response.statusText}`);
      }

      // For rate limiting (429), throw a specialized error when we're out of retries
      if (attempt >= maxRetries && response.status === 429) {
        throw new RateLimitError(
          `Rate limit exceeded with status code ${response.status}. Check retryAfterSeconds for wait time.`,
          response,
        );
      }

      // For retryable status codes, attempt to retry
      if (attempt < maxRetries) {
        const errorMessage = `Received status code ${response.status}, retrying (${attempt + 1}/${maxRetries})`;
        if (process.env.NODE_ENV === 'development') console.warn(errorMessage);
        lastError = new Error(errorMessage);

        // If the response has a 'Retry-After' header, use that instead of exponential backoff
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const waitTime = parseInt(retryAfter, 10) * 1000; // Convert to milliseconds
          if (!isNaN(waitTime) && waitTime > 0) {
            // Check if aborted before waiting
            if (aborted || init?.signal?.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }

            await sleep(waitTime);

            // Check if aborted after waiting
            if (aborted || init?.signal?.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }

            // Skip the backoff calculation since we already waited
            continue;
          }
        }
      } else {
        // If we're out of retries for other retryable status codes, throw a clear error
        throw new Error(`Request failed with status ${response.status} after ${maxRetries} retries`);
      }
    } catch (error) {
      lastError = error;

      // If it's an abort error, clean up and rethrow
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (init?.signal) {
          init.signal.removeEventListener('abort', onAbort);
        }
        throw error;
      }

      // If it's not a network error or we're not retrying network errors, throw immediately
      if (!retryNetworkErrors || !isNetworkError(error)) {
        throw error;
      }

      if (attempt < maxRetries) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Network error, retrying (${attempt + 1}/${maxRetries})`, error);
        }
      } else {
        throw error; // Out of retries, propagate the error
      }
    }
  }

  // This should never be reached due to the loop structure, but TypeScript doesn't know that
  try {
    throw lastError;
  } finally {
    // Clean up event listeners
    if (init?.signal) {
      init.signal.removeEventListener('abort', onAbort);
    }
  }
};
