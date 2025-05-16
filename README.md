# Hacker News Reel

[![License][license-badge]][license]
[![npm version](https://img.shields.io/npm/v/hacker-news-reel.svg)](https://www.npmjs.com/package/hacker-news-reel)
[![CI](https://github.com/stevekinney/hacker-news-reel/actions/workflows/ci.yml/badge.svg)](https://github.com/stevekinney/hacker-news-reel/actions/workflows/ci.yml)

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

<table>
  <thead>
    <tr>
      <th align="left">Method</th>
      <th align="left">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>getTopStories()</code></td>
      <td>IDs of top stories</td>
    </tr>
    <tr>
      <td><code>getNewStories()</code></td>
      <td>IDs of newest stories</td>
    </tr>
    <tr>
      <td><code>getBestStories()</code></td>
      <td>IDs of best-ranked stories</td>
    </tr>
    <tr>
      <td><code>getAskStories()</code></td>
      <td>IDs of Ask HN stories</td>
    </tr>
    <tr>
      <td><code>getShowStories()</code></td>
      <td>IDs of Show HN stories</td>
    </tr>
    <tr>
      <td><code>getJobStories()</code></td>
      <td>IDs of job listings</td>
    </tr>
    <tr>
      <td><code>getItem(id)</code></td>
      <td>Fetch a story/comment/job by ID</td>
    </tr>
    <tr>
      <td><code>getItems(ids, concurrency?)</code></td>
      <td>Batch fetch (optional concurrency limit)</td>
    </tr>
    <tr>
      <td><code>getUser(username)</code></td>
      <td>Fetch a user profile</td>
    </tr>
    <tr>
      <td><code>getItemWithComments(id, opts?)</code></td>
      <td>Story + nested comments (<code>maxDepth</code>, <code>concurrency</code>)</td>
    </tr>
  </tbody>
</table>

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


## 🛡️ Caching & Rate Limiting

<table>
  <thead>
    <tr>
      <th align="left">Resource</th>
      <th align="center">Fresh (maxAge)</th>
      <th align="center">Stale (<code>staleWhileRevalidate</code>)</th>
      <th align="center">Max Entries</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="left">Items</td>
      <td align="center"><code>5 min</code></td>
      <td align="center"><code>1 h</code></td>
      <td align="center">2000</td>
    </tr>
    <tr>
      <td align="left">Lists</td>
      <td align="center"><code>30 s</code></td>
      <td align="center"><code>2 min</code></td>
      <td align="center">20</td>
    </tr>
    <tr>
      <td align="left">Users</td>
      <td align="center"><code>5 min</code></td>
      <td align="center"><code>30 min</code></td>
      <td align="center">500</td>
    </tr>
    <tr>
      <td align="left">Search</td>
      <td align="center"><code>30 s</code></td>
      <td align="center"><code>2 min</code></td>
      <td align="center">500</td>
    </tr>
  </tbody>
</table>

Uses LRU eviction and [Bottleneck](https://npm.im/bottleneck) to throttle Algolia (~2.7 req/s) in order to make sure we don't run into the 10,000/hour rate limit.

## 🧠 Advanced Usage

### Cache Invalidation

Manually solve one of the hardest problems in computer science.

```ts
client.invalidateItemCache(id);
client.clearAllCaches();
```

### Hooks

Add custom hooks for request/response lifecycle:

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

## 📊 API Reference

### Zod Schemas

| Schema Name | Description |
|:------------|:------------|
| `HackerNewsIdSchema` | ✓ Validates a Hacker News item ID (number, integer, non-negative) |
| `HackerNewsUsernameSchema` | ✓ Validates a Hacker News username (non-empty string) |
| `HackerNewsIdListSchema` | ✓ Validates an array of Hacker News item IDs |
| `HackerNewsItemTypeSchema` | ✓ Validates item types ('job', 'story', 'comment', 'poll', 'pollopt') |
| `HackerNewsItemSchema` | ✓ Validates complete Hacker News items (stories, comments, etc.) |
| `HackerNewsUserSchema` | ✓ Validates Hacker News user profiles |
| `HackerNewsUpdatesSchema` | ✓ Validates the updates endpoint response (changed items and profiles) |

### TypeScript Types

<table>
  <thead>
    <tr>
      <th align="left">Type Name</th>
      <th align="left">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>FetchType</code></td>
      <td>Type alias for the Fetch API</td>
    </tr>
    <tr>
      <td><code>FetchParameters</code></td>
      <td>Parameters type for fetch function</td>
    </tr>
    <tr>
      <td><code>RequestInfo</code></td>
      <td>Type for fetch request info (URL or string)</td>
    </tr>
    <tr>
      <td><code>RequestInit</code></td>
      <td>Type for fetch request init options</td>
    </tr>
    <tr>
      <td><code>HackerNewsId</code></td>
      <td>Type alias for a Hacker News item ID (number)</td>
    </tr>
    <tr>
      <td><code>HackerNewsUsername</code></td>
      <td>Type alias for a Hacker News username (string)</td>
    </tr>
    <tr>
      <td><code>HackerNewsIdList</code></td>
      <td>Type alias for an array of Hacker News item IDs</td>
    </tr>
    <tr>
      <td><code>HackerNewsItemType</code></td>
      <td>Union type for item types ('job', 'story', 'comment', 'poll', 'pollopt')</td>
    </tr>
    <tr>
      <td><code>HackerNewsItem</code></td>
      <td>Interface for Hacker News items (stories, comments, etc.)</td>
    </tr>
    <tr>
      <td><code>HackerNewsCommentTree</code></td>
      <td>Extended HackerNewsItem with nested replies for comment trees</td>
    </tr>
    <tr>
      <td><code>HackerNewsUser</code></td>
      <td>Interface for Hacker News user profiles</td>
    </tr>
    <tr>
      <td><code>HackerNewsUpdates</code></td>
      <td>Interface for updates endpoint response</td>
    </tr>
    <tr>
      <td><code>CacheOptions</code></td>
      <td>Interface for cache configuration options</td>
    </tr>
    <tr>
      <td><code>RetryOptions</code></td>
      <td>Interface for retry mechanism configuration</td>
    </tr>
    <tr>
      <td><code>ClientOptions</code></td>
      <td>Interface for client configuration options</td>
    </tr>
  </tbody>
</table>

[license-badge]: https://img.shields.io/npm/l/hacker-news-reel.svg
[license]: https://opensource.org/licenses/MIT