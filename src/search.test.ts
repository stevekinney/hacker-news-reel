import { expect, mock, test, type Mock } from 'bun:test';
import { createSearchClient } from './search';

// Create mock search response
const mockSearchResponse = {
  hits: [
    {
      objectID: '12345',
      title: 'Test Story',
      url: 'https://example.com',
      author: 'user',
      points: 100,
      story_text: null,
      comment_text: null,
      _tags: ['story', 'front_page'],
      created_at: '2023-01-01T00:00:00.000Z',
      created_at_i: 1672531200,
      num_comments: 10,
    },
  ],
  page: 0,
  nbHits: 1,
  nbPages: 1,
  hitsPerPage: 20,
  processingTimeMS: 1,
  query: 'test',
};

// Create a mock fetch function
const mockFetch = mock(async (_url: URL | string) => {
  return {
    ok: true,
    json: async () => mockSearchResponse,
    statusText: 'OK',
  };
}) as unknown as Mock<typeof globalThis.fetch>;

// Create search client with mock fetch
const searchClient = createSearchClient({ fetch: mockFetch as unknown as typeof globalThis.fetch });

// Extract search functions from client
const { searchStories, getFrontPageStories, invalidateSearchCache, clearSearchCache } = searchClient;

test('searchStories works with mock fetch', async () => {
  const results = await searchStories('test');
  expect(results).toEqual(mockSearchResponse);
  expect(mockFetch).toHaveBeenCalled();
});

test('getFrontPageStories works with mock fetch', async () => {
  const results = await getFrontPageStories();
  expect(results).toEqual(mockSearchResponse);
  expect(mockFetch).toHaveBeenCalled();
});

test('invalidateSearchCache does not throw', () => {
  expect(() => {
    invalidateSearchCache('javascript');
  }).not.toThrow();
});

test('clearSearchCache does not throw', () => {
  expect(() => {
    clearSearchCache();
  }).not.toThrow();
});

test('searchStories with options works with mock fetch', async () => {
  const results = await searchStories('react', {
    tags: ['story', 'show_hn'],
    page: 0,
    hitsPerPage: 5,
    sortByDate: true,
    numericFilters: [{ field: 'points', operator: '>', value: 100 }],
  });

  expect(results).toEqual(mockSearchResponse);
  expect(mockFetch).toHaveBeenCalled();

  // Check that URL parameters were set correctly
  const calls = mockFetch.mock.calls;
  const lastCall = calls[calls.length - 1];
  const url = String(lastCall?.[0]);

  expect(url).toContain('search_by_date'); // sortByDate=true should use search_by_date endpoint
  expect(url).toContain('tags=story%2Cshow_hn');
  expect(url).toContain('page=0');
  expect(url).toContain('hitsPerPage=5');
  expect(url).toContain('numericFilters=points%3E100');
});

test('searchStories with author filter works with mock fetch', async () => {
  const results = await searchStories('', {
    author: 'dang',
  });

  expect(results).toEqual(mockSearchResponse);
  expect(mockFetch).toHaveBeenCalled();

  const calls = mockFetch.mock.calls;
  const lastCall = calls[calls.length - 1];
  const url = lastCall?.[0].toString();

  expect(url).toContain('tags=story%2Cauthor_dang');
});

test('searchStories with story filter works with mock fetch', async () => {
  const results = await searchStories('', {
    storyId: 123456,
  });

  expect(results).toEqual(mockSearchResponse);
  expect(mockFetch).toHaveBeenCalled();

  const calls = mockFetch.mock.calls;
  const lastCall = calls[calls.length - 1];
  const url = lastCall?.[0].toString();

  expect(url).toContain('tags=story%2Cstory_123456');
});
