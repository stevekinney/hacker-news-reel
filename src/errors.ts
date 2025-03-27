/**
 * Custom error class for rate limit responses
 * Contains information about the rate limit and when to retry
 */

export class RateLimitError extends Error {
  /**
   * HTTP status code (typically 429 Too Many Requests)
   */
  status: number;

  /**
   * Original Response object from the fetch request
   */
  response: Response;

  /**
   * Suggested retry time in seconds, extracted from the Retry-After header
   */
  retryAfterSeconds?: number;

  /**
   * Creates a new RateLimitError
   * @param message Error message
   * @param response The response object that triggered the rate limit
   */
  constructor(message: string, response: Response) {
    super(message);
    this.name = 'RateLimitError';
    this.status = response.status;
    this.response = response;

    // Extract Retry-After header if present
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      this.retryAfterSeconds = parseInt(retryAfter, 10);
    }
  }
}
