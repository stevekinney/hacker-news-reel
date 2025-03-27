import { afterEach, beforeEach, expect, mock, test, setSystemTime } from 'bun:test';
import { RateLimitError } from './errors';
import { calculateBackoff, DEFAULT_RETRY_OPTIONS, fetchWithRetry } from './utilities';

// The original fetch function
const originalFetch = globalThis.fetch;

// Helper function to properly mock fetch with complete Response object

const mockFetchImplementation = <T>(fn: () => T): typeof fetch => {
  // Using unknown cast followed by type assertion to avoid unsafe "any" in final code
  return mock(fn) as unknown as typeof fetch;
};

beforeEach(() => {
  // Reset the fetch mock before each test
  globalThis.fetch = mockFetchImplementation(() => {
    throw new Error('Fetch was called without being mocked properly');
  });
});

afterEach(() => {
  // Restore the original fetch function after each test
  globalThis.fetch = originalFetch;
});

test('calculateBackoff generates values with exponential growth', () => {
  const options = DEFAULT_RETRY_OPTIONS;

  // Disable jitter for predictable test
  const noJitterOptions = { ...options, jitter: 0 };

  // First attempt should get initial backoff
  expect(calculateBackoff(0, noJitterOptions)).toBe(options.initialBackoff);

  // Second attempt should be initialBackoff * backoffFactor
  expect(calculateBackoff(1, noJitterOptions)).toBe(options.initialBackoff * options.backoffFactor);

  // Third attempt should be initialBackoff * backoffFactor^2
  expect(calculateBackoff(2, noJitterOptions)).toBe(options.initialBackoff * Math.pow(options.backoffFactor, 2));

  // Should respect max backoff
  expect(calculateBackoff(10, noJitterOptions)).toBe(options.maxBackoff);
});

test('calculateBackoff applies jitter correctly', () => {
  const options = DEFAULT_RETRY_OPTIONS;

  // Set jitter to 0.5 (±50%)
  const jitteryOptions = { ...options, jitter: 0.5 };

  // With 0.5 jitter, result should be between 50% and 150% of base value
  const baseValue = options.initialBackoff;
  const result = calculateBackoff(0, jitteryOptions);

  // Result should be between baseValue * 0.5 and baseValue * 1.5
  expect(result).toBeGreaterThanOrEqual(baseValue * 0.5);
  expect(result).toBeLessThanOrEqual(baseValue * 1.5);
});

test('fetchWithRetry returns response immediately for successful requests', async () => {
  const mockResponse = { ok: true, json: () => Promise.resolve({ data: 'test' }) } as Response;

  // Set the mock for this test
  globalThis.fetch = mockFetchImplementation(() => mockResponse);

  const result = await fetchWithRetry('https://example.com');
  expect(result).toBe(mockResponse);
  expect(globalThis.fetch).toHaveBeenCalled();
});

test('fetchWithRetry retries on network errors', async () => {
  let attempts = 0;
  // Initialize mockResponse to avoid "used before being assigned" error
  let mockResponse = { ok: true } as Response;

  // Override global fetch with our mock
  globalThis.fetch = mockFetchImplementation(() => {
    attempts++;

    // Fail first two attempts, succeed on third
    if (attempts <= 2) {
      throw new TypeError('Failed to fetch');
    }

    mockResponse = { ok: true } as Response;
    return mockResponse;
  });

  // Use low backoff values for faster test
  const retryOptions = {
    maxRetries: 3,
    initialBackoff: 1,
    maxBackoff: 10,
    jitter: 0,
    retryableStatusCodes: [429, 500],
    retryNetworkErrors: true,
    backoffFactor: 2,
  };

  const result = await fetchWithRetry('https://example.com', undefined, retryOptions);

  expect(result).toEqual(mockResponse);
  expect(attempts).toBe(3);
});

test('fetchWithRetry retries on retryable status codes', async () => {
  let attempts = 0;
  // Initialize mockResponse to avoid "used before being assigned" error
  let mockResponse = { ok: true } as Response;

  // Override global fetch with our mock
  globalThis.fetch = mockFetchImplementation(() => {
    attempts++;

    // Return 429 for first two attempts, ok on third
    if (attempts <= 2) {
      // Create a more complete Response object
      return new Response(null, {
        status: 429,
        headers: { 'Retry-After': '0' }, // Set to 0 for faster test
      });
    }

    mockResponse = { ok: true } as Response;
    return mockResponse;
  });

  // Use low backoff values for faster test
  const retryOptions = {
    maxRetries: 3,
    initialBackoff: 1,
    maxBackoff: 10,
    jitter: 0,
    retryableStatusCodes: [429, 500],
    retryNetworkErrors: true,
    backoffFactor: 2,
  };

  const result = await fetchWithRetry('https://example.com', undefined, retryOptions);

  expect(result).toEqual(mockResponse);
  expect(attempts).toBe(3);
});

test('fetchWithRetry respects Retry-After header', async () => {
  let attempts = 0;
  // Initialize mockResponse to avoid "used before being assigned" error
  let mockResponse = { ok: true } as Response;
  // Save the original setTimeout to restore it after our test
  const originalSetTimeout = globalThis.setTimeout;
  let originalTime: number | null = null;

  try {
    // Store the current time
    originalTime = Date.now();

    // Create a mock implementation of setTimeout that fast-forwards time
    // Use unknown and then typeof setTimeout to properly type our mock

    globalThis.setTimeout = function mockedSetTimeout(callback: (...args: unknown[]) => void, ms: number) {
      // Manually adjust our time reference
      const newTime = Date.now() + ms;

      // Use setSystemTime from bun:test to advance time
      // This approach is simpler than using jest.useFakeTimers()
      setSystemTime(new Date(newTime));

      // Execute the callback immediately
      callback();

      // Return a dummy timeout ID
      return 0;
    } as unknown as typeof setTimeout;

    // Override global fetch
    globalThis.fetch = mockFetchImplementation(() => {
      attempts++;

      if (attempts === 1) {
        // First attempt: Return 429 with Retry-After header
        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': '1' }, // 1 second wait
        });
      }

      // Second attempt: Return success
      mockResponse = { ok: true } as Response;
      return mockResponse;
    });

    const startTime = Date.now();

    // Execute the function with mocked timers
    const result = await fetchWithRetry('https://example.com');

    // We should have advanced time by at least 1000ms (1 second)
    const elapsedTime = Date.now() - startTime;
    expect(elapsedTime).toBeGreaterThanOrEqual(1000);
    expect(result).toEqual(mockResponse);
    expect(attempts).toBe(2);
  } finally {
    // Restore original time if we modified it
    if (originalTime !== null) {
      setSystemTime(); // Reset to real time
    }

    // Restore the original setTimeout
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('fetchWithRetry does not retry when retry is set to false', async () => {
  let attempts = 0;

  // Override global fetch
  globalThis.fetch = mockFetchImplementation(() => {
    attempts++;
    throw new TypeError('Failed to fetch');
  });

  // Disable retries
  await expect(async () => {
    await fetchWithRetry('https://example.com', undefined, false);
  }).toThrow('Failed to fetch');

  expect(attempts).toBe(1);
});

test('fetchWithRetry gives up after maxRetries attempts', async () => {
  let attempts = 0;

  // Override global fetch
  globalThis.fetch = mockFetchImplementation(() => {
    attempts++;
    throw new TypeError('Failed to fetch');
  });

  const retryOptions = {
    maxRetries: 2,
    initialBackoff: 1,
    maxBackoff: 10,
    jitter: 0,
  };

  await expect(async () => {
    await fetchWithRetry('https://example.com', undefined, retryOptions);
  }).toThrow('Failed to fetch');

  // Should have tried 1 initial attempt + 2 retries = 3 total
  expect(attempts).toBe(3);
});

test('fetchWithRetry throws RateLimitError with retry information when rate limited', async () => {
  const retryAfter = '30';

  // Override global fetch with mock that returns a 429 status
  globalThis.fetch = mockFetchImplementation(() => {
    return new Response(null, {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'Retry-After': retryAfter },
    });
  });

  const retryOptions = {
    maxRetries: 0, // Set to 0 to immediately trigger the error
    initialBackoff: 1,
    maxBackoff: 10,
    jitter: 0,
    retryableStatusCodes: [429],
  };

  try {
    await fetchWithRetry('https://example.com', undefined, retryOptions);
    // Should not reach here
    expect(false).toBe(true);
  } catch (e) {
    const error = e as RateLimitError;
    // Verify it's a RateLimitError with the right properties
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(parseInt(retryAfter, 10));
    expect(error.message).toContain('Rate limit exceeded');
  }
});

test('fetchWithRetry throws error for non-retryable status codes', async () => {
  // Override global fetch with mock that returns a 404 status
  globalThis.fetch = mockFetchImplementation(() => {
    return new Response(null, {
      status: 404,
      statusText: 'Not Found',
    });
  });

  const retryOptions = {
    retryableStatusCodes: [429, 500],
    maxRetries: 3,
  };

  try {
    await fetchWithRetry('https://example.com', undefined, retryOptions);
    // Should not reach here
    expect(false).toBe(true);
  } catch (e) {
    const error = e as Error;
    // Verify it's a regular Error with the right message
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Request failed with status 404: Not Found');
  }
});

test('fetchWithRetry throws error after exhausting retries for retryable status codes', async () => {
  let attempts = 0;

  // Override global fetch with mock that always returns a 500 status
  globalThis.fetch = mockFetchImplementation(() => {
    attempts++;
    return new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  });

  const retryOptions = {
    maxRetries: 2,
    initialBackoff: 1,
    maxBackoff: 10,
    jitter: 0,
    retryableStatusCodes: [500],
  };

  try {
    await fetchWithRetry('https://example.com', undefined, retryOptions);
    // Should not reach here
    expect(false).toBe(true);
  } catch (e) {
    const error = e as Error;
    // Verify it's a regular Error with the right message indicating retries were exhausted
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Request failed with status 500 after 2 retries');
    expect(attempts).toBe(3); // initial + 2 retries
  }
});

test('fetchWithRetry respects AbortSignal and stops retries when aborted', async () => {
  let attempts = 0;
  const controller = new AbortController();
  const { signal } = controller;

  // Override global fetch with mock that always returns a 500 status
  globalThis.fetch = mockFetchImplementation(() => {
    attempts++;

    // Abort after the first attempt
    if (attempts === 1) {
      setTimeout(() => controller.abort(), 0);
    }

    return new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  });

  const retryOptions = {
    maxRetries: 2,
    initialBackoff: 1,
    maxBackoff: 10,
    jitter: 0,
    retryableStatusCodes: [500],
  };

  try {
    await fetchWithRetry('https://example.com', { signal }, retryOptions);
    // Should not reach here
    expect(false).toBe(true);
  } catch (e) {
    const error = e as DOMException;
    // Verify it's an AbortError
    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('The operation was aborted.');
    expect(attempts).toBe(1); // Only one attempt before abort
  }
});
