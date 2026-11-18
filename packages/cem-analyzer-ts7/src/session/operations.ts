import type {DiscoveryOperationOptions} from '../contracts.js';

export function checkCancelled(options?: DiscoveryOperationOptions): void {
  options?.signal?.throwIfAborted();
}
