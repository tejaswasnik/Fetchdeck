export class InvalidUrlError extends Error {
  constructor(message = 'Invalid URL') {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

export class RangeIgnoredError extends Error {
  constructor(message = 'Server ignored the Range header') {
    super(message);
    this.name = 'RangeIgnoredError';
  }
}

export class ShortSegmentError extends Error {
  constructor(message = 'Connection ended before the segment was complete', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShortSegmentError';
  }
}

export class CorruptRecordError extends Error {
  constructor(message = 'Download record is corrupt') {
    super(message);
    this.name = 'CorruptRecordError';
  }
}
