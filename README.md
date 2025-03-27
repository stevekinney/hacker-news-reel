# Hacker News Reel

[![License][license-badge]][license]
[![npm version](https://img.shields.io/npm/v/hacker-news-reel.svg)](https://www.npmjs.com/package/hacker-news-reel)
[![CI](https://github.com/stevekinney/hacker-news-reel/actions/workflows/ci.yml/badge.svg)](https://github.com/stevekinney/hacker-news-reel/actions/workflows/ci.yml)
[![Tests](https://github.com/stevekinney/hacker-news-reel/actions/workflows/test.yml/badge.svg)](https://github.com/stevekinney/hacker-news-reel/actions/workflows/test.yml)
[![Lint](https://github.com/stevekinney/hacker-news-reel/actions/workflows/lint.yml/badge.svg)](https://github.com/stevekinney/hacker-news-reel/actions/workflows/lint.yml)
[![Type Check](https://github.com/stevekinney/hacker-news-reel/actions/workflows/typecheck.yml/badge.svg)](https://github.com/stevekinney/hacker-news-reel/actions/workflows/typecheck.yml)

A lightning-fast, type-safe Hacker News API client with built-in Zod validation—because guessing is overrated. Built for modern TypeScript, Node.js, Deno, and Bun.

## 🚀 Features

- **Type-safe**: Zod schemas validate everything at compile time  
- **Promise-based** with optional parallel fetching  
- **In-memory caching** (`stale-while-revalidate`) to keep your app snappy  
- **Automatic rate-limiting** & retry with exponential backoff  
- **Recursive comment-tree fetching** with configurable depth & concurrency  
- **Algolia-powered search** (front page & full-text)  
- **Extensible**: swap out `fetch` for any environment  
- **Bundled Types**: Full TS types and schemas exported for your IDE

## 💾 Installation

```bash
npm install hacker-news-reel
# or
yarn add hacker-news-reel
# or
bun add hacker-news-reel
```

## ⚡ Quick Start

```ts
import { createClient } from 'hacker-news-reel';

const client = createClient({
  retry: { maxRetries: 5, initialBackoff: 500 },
});

// Get top stories
const topIds = await client.getTopStories();
const story = await client.getItemWithComments(topIds[0], { maxDepth: 2 });

console.log(`1. ${story.title} — ${story.url}`);

story.comments.forEach((c, i) => {
  console.log(`${i + 1}. ${c.by}: ${c.text}`);
});
```

## 🧰 API Reference

### Client Creation

```ts
import { createClient } from 'hacker-news-reel';

const client = createClient({
  fetch: myFetchImpl,        // defaults to global fetch
  retry: false | { maxRetries: number; initialBackoff: number },
});
```

### Fetching Stories & Comments

| Method                               | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| `getTopStories()`                    | IDs of top stories                                  |
| `getNewStories()`                    | IDs of newest stories                               |
| `getBestStories()`                   | IDs of best-ranked stories                          |
| `getAskStories()`                    | IDs of Ask HN stories                               |
| `getShowStories()`                   | IDs of Show HN stories                              |
| `getJobStories()`                    | IDs of job listings                                 |
| `getItem(id)`                        | Fetch a story/comment/job by ID                     |
| `getItems(ids, concurrency?)`        | Batch fetch (optional concurrency limit)            |
| `getUser(username)`                  | Fetch a user profile                                |
| `getItemWithComments(id, opts?)`     | Story + nested comments (`maxDepth`, `concurrency`) |

### Search API

```ts
import { createSearchClient } from 'hacker-news-reel';

const search = createSearchClient({
  limiter: { /* Bottleneck options */ },
  fetch: customFetch,
  retry: { maxRetries: 3, initialBackoff: 300 },
});

const results = await search.searchStories('typescript', { hitsPerPage: 10 });
console.log(`Found ${results.nbHits} hits.`);
```

### Error Handling

All rate limits throw a `RateLimitError`:

```ts
import { RateLimitError } from 'hacker-news-reel';

try {
  await client.getNewStories();
} catch (err) {
  if (err instanceof RateLimitError) {
    console.warn(`Rate limited! Retry after ${err.retryAfterSeconds}s.`);
  } else {
    throw err;
  }
}
```

### Schemas & Types

- **Zod Schemas**: `HackerNewsItemSchema`, `HackerNewsUserSchema`, etc.  
- **TS Types**: `HackerNewsItem`, `HackerNewsCommentTree`, `HackerNewsUser`, etc.

## 🛡️ Caching & Rate Limiting

| Resource | Fresh (maxAge) | Stale (`staleWhileRevalidate`)  | Max Entries |
| -------- | -------------- | ------------------------------- | ----------- |
| Items    | 5 min          | 1 h                             | 2000        |
| Lists    | 30 s           | 2 min                           | 20          |
| Users    | 5 min          | 30 min                          | 500         |
| Search   | 30 s           | 2 min                           | 500         |

Uses LRU eviction and Bottleneck to throttle Algolia (~2.7 req/s).

## 🧠 Advanced Usage

- Swap `fetch` for Deno, Node streams, AWS Lambda, Cloudflare Workers, etc.  
- Customize retry/backoff strategies  
- Invalidate caches on-the-fly:
  ```ts
  client.invalidateItemCache(id);
  client.clearAllCaches();
  ```
- Add custom hooks for request/response lifecycle:
  ```ts
  client.use({
    beforeFetch: (url, opts) => {
      // Add headers, log request, start timer
      console.log(`Fetching: ${url}`);
      const headers = { ...opts?.headers, 'x-custom-header': 'value' };
      return { url, options: { ...opts, headers } };
    },
    afterFetch: (response) => {
      // Record metrics, inspect responses
      console.log(`Response: ${response.status} from ${response.url}`);
      return response;
    },
    onError: (err) => {
      // Handle or transform errors
      console.error(`Error: ${err.message}`);
      // Return a new error to replace the original
      return new Error(`Wrapped: ${err.message}`);
    }
  });
  ```

[license-badge]: https://img.shields.io/npm/l/hacker-news-reel.svg
[license]: https://opensource.org/licenses/MIT