import { expect, test } from 'bun:test';
import { createClient } from './api';
import { HooksManager } from './hooks';
import type { RequestInfo, RequestInit } from './types';

test('HooksManager should register and run hooks in sequence', async () => {
  const manager = new HooksManager();

  const order: string[] = [];

  manager.register({
    beforeFetch: (url: RequestInfo) => {
      order.push('before1');
      return { url, options: undefined };
    },
  });

  manager.register({
    beforeFetch: (url: RequestInfo, options?: RequestInit) => {
      order.push('before2');
      return { url, options };
    },
    afterFetch: (response: Response) => {
      order.push('after1');
      return response;
    },
  });

  manager.register({
    afterFetch: (response: Response) => {
      order.push('after2');
      return response;
    },
  });

  const mockResponse = new Response();

  await manager.runBeforeFetchHooks('https://example.com');
  await manager.runAfterFetchHooks(mockResponse);

  expect(order).toEqual(['before1', 'before2', 'after1', 'after2']);
});

test('Client should support hooks for request lifecycle', async () => {
  const events: string[] = [];
  const headers: Record<string, string> = {};

  // Mock fetch function for testing
  const mockFetch = async (_url: RequestInfo, _init?: RequestInit) => {
    events.push('fetch');
    return new Response('{"id":1,"title":"Test"}', {
      headers: new Headers(headers),
    });
  };

  const client = createClient({
    fetch: mockFetch as unknown as typeof fetch,
    hooks: {
      beforeFetch: (url: RequestInfo, options?: RequestInit) => {
        events.push('beforeFetch');
        // Add a custom header
        const newOptions = options ? { ...options } : {};
        newOptions.headers = { ...(newOptions.headers || {}), 'x-test': 'test-value' };
        headers['x-test'] = 'test-value'; // For verification
        return { url, options: newOptions };
      },
      afterFetch: (response: Response) => {
        events.push('afterFetch');
        return response;
      },
    },
  });

  // Add another hook
  client.use({
    beforeFetch: (url: RequestInfo, options?: RequestInit) => {
      events.push('additionalBeforeFetch');
      return { url, options };
    },
    afterFetch: (response: Response) => {
      events.push('additionalAfterFetch');
      return response;
    },
  });

  // Trigger a fetch
  await client.getItem(1);

  // Verify execution order
  expect(events).toEqual(['beforeFetch', 'additionalBeforeFetch', 'fetch', 'afterFetch', 'additionalAfterFetch']);
});

test('Hooks manager should handle errors', async () => {
  // Test the HooksManager directly instead of through the client
  const manager = new HooksManager();

  let errorHandled = false;
  let errorMessage: string | undefined;

  manager.register({
    onError: (error) => {
      errorHandled = true;
      errorMessage = error.message;
      // Return a new error
      return new Error('Modified error');
    },
  });

  const originalError = new Error('Test error');
  const result = await manager.runOnErrorHooks(originalError);

  expect(errorHandled).toBe(true);
  expect(errorMessage).toBe('Test error');
  expect(result.message).toBe('Modified error');
});
