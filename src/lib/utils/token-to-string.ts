import type { Token } from '../types/tokens.js';

/**
 * Convert a service token to a string for error messages
 */
export function tokenToString(token: Token<unknown>): string {
  if (typeof token === 'symbol') {
    return token.description ?? token.toString();
  }
  return token.name;
}
