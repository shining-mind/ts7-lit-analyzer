/**
 * Coalesces concurrent resolutions of a key into one in-flight promise and
 * caches the settled value. A per-key epoch lets invalidation discard a
 * resolution that completes after the key was invalidated, and a failed
 * resolution evicts its promise so a later call can retry. A global generation
 * lets a snapshot change discard every resolution captured against the previous
 * generation, even ones that start resolving after the change. Values are cached
 * only while their epoch and generation are unchanged; callers awaiting a stale
 * in-flight promise still receive its result, but it is not stored. In-flight
 * promises are tagged with their generation and only same-generation requests
 * coalesce, so a fresh caller never joins a stale-generation resolution.
 */
export class SingleFlightCache<V> {
  private readonly values = new Map<string, V>();
  private readonly inFlight = new Map<
    string,
    {promise: Promise<V>; generation: number}
  >();
  private readonly epochs = new Map<string, number>();
  private generation = 0;

  get(key: string): V | undefined {
    return this.values.get(key);
  }

  keys(): string[] {
    return [...new Set([...this.values.keys(), ...this.inFlight.keys()])];
  }

  get currentGeneration(): number {
    return this.generation;
  }

  /** Advances the generation so resolutions captured against it stop caching. */
  bumpGeneration(): void {
    this.generation += 1;
  }

  /**
   * Evicts the cached value and any in-flight promise, bumping the epoch so a
   * completing stale resolution is not stored and the next resolve starts a
   * fresh resolution rather than returning the stale in-flight promise.
   */
  invalidate(key: string): void {
    this.values.delete(key);
    this.inFlight.delete(key);
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
  }

  /**
   * Drops every in-flight promise so the next resolve starts fresh, and bumps
   * their epochs so completing results are not stored. Settled values are kept.
   */
  staleInFlight(): void {
    for (const key of [...this.inFlight.keys()]) {
      this.inFlight.delete(key);
      this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    }
  }

  resolve(
    key: string,
    produce: () => Promise<V>,
    generation = this.generation
  ): Promise<V> {
    if (this.values.has(key)) {
      return Promise.resolve(this.values.get(key)!);
    }
    const pending = this.inFlight.get(key);
    if (pending && pending.generation === generation) return pending.promise;

    const epoch = this.epochs.get(key) ?? 0;
    const promise = produce().then((value) => {
      if (
        (this.epochs.get(key) ?? 0) === epoch &&
        generation === this.generation
      ) {
        this.values.set(key, value);
      }
      return value;
    });

    this.inFlight.set(key, {promise, generation});
    const settle = () => {
      const current = this.inFlight.get(key);
      if (current?.promise === promise) this.inFlight.delete(key);
    };
    promise.then(settle, settle);
    return promise;
  }
}
