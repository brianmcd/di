import type { OnDestroy } from '../types/lifecycle.js';

/**
 * Type guard to check if an instance implements OnDestroy
 */
export function hasOnDestroy(instance: unknown): instance is OnDestroy {
  return typeof (instance as OnDestroy).onDestroy === 'function';
}
