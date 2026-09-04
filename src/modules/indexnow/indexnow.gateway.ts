export interface IndexNowGatewaySubmission {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export interface IndexNowGatewayResult {
  accepted: boolean;
  statusCode: number;
  retryable: boolean;
}

export class IndexNowGatewayError extends Error {
  readonly name = 'IndexNowGatewayError';

  constructor(
    message: string,
    public readonly code: 'INDEXNOW_NETWORK_ERROR' | 'INDEXNOW_TIMEOUT',
    public readonly retryable: boolean
  ) {
    super(message);
  }
}

export class IndexNowHttpGateway {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(input: {
    endpoint: string;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
  }) {
    this.endpoint = input.endpoint;
    this.timeoutMs = input.timeoutMs;
    this.fetchImpl = input.fetchImpl ?? globalThis.fetch;
  }

  async submit(input: IndexNowGatewaySubmission): Promise<IndexNowGatewayResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(input),
        signal: controller.signal
      });
      const accepted = response.status === 200 || response.status === 202;
      return {
        accepted,
        statusCode: response.status,
        retryable: !accepted && (response.status === 429 || response.status >= 500)
      };
    } catch {
      if (controller.signal.aborted) {
        throw new IndexNowGatewayError('IndexNow request timed out', 'INDEXNOW_TIMEOUT', true);
      }
      throw new IndexNowGatewayError('IndexNow request failed', 'INDEXNOW_NETWORK_ERROR', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
