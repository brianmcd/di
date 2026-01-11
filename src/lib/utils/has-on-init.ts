import type { OnInit } from '../types/lifecycle.js';

/**
 * Type guard to check if an instance implements OnInit
 */
export function hasOnInit(instance: unknown): instance is OnInit {
  return typeof (instance as OnInit).onInit === 'function';
}
