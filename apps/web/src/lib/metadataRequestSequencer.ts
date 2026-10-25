/**
 * Independent sequencing for provider cache checks, network refreshes, and env
 * diagnostics. A cache-only check must not invalidate an in-flight network or
 * environment request. This is request coordination, not another data cache.
 */
export class MetadataRequestSequencer {
  private cacheCheck = 0;
  private networkRefresh = 0;
  private environmentRefresh = 0;

  beginCacheCheck(): number {
    this.cacheCheck += 1;
    return this.cacheCheck;
  }

  beginNetworkRefresh(): number {
    this.networkRefresh += 1;
    return this.networkRefresh;
  }

  beginEnvironmentRefresh(): number {
    this.environmentRefresh += 1;
    return this.environmentRefresh;
  }

  isCacheCheckCurrent(request: number): boolean {
    return request === this.cacheCheck;
  }

  isNetworkRefreshCurrent(request: number): boolean {
    return request === this.networkRefresh;
  }

  isEnvironmentRefreshCurrent(request: number): boolean {
    return request === this.environmentRefresh;
  }

  invalidate(): void {
    this.cacheCheck += 1;
    this.networkRefresh += 1;
    this.environmentRefresh += 1;
  }
}

/** Newer network data may replace the visible copy; equal times use operation order. */
export function shouldApplyMetadataNetworkResult(options: {
  requestCurrent: boolean;
  resultSavedAt: number;
  visibleSavedAt: number | null;
}): boolean {
  return options.requestCurrent &&
    (options.visibleSavedAt === null || options.resultSavedAt >= options.visibleSavedAt);
}
