import type {DiscoveryOperationOptions} from '../contracts.js';

/**
 * Asserts that the operation has not been cancelled.
 *
 * @throws {unknown} The signal's abort reason, if the operation was cancelled.
 */
export function assertNotCancelled(options?: DiscoveryOperationOptions): void {
  options?.signal?.throwIfAborted();
}
