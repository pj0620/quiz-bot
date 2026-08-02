/**
 * Exhaustiveness guard for discriminated unions. Adding a new InfoSource type
 * without handling it turns into a compile error at every switch statement.
 */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
