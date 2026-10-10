// Internal exhaustiveness helper. Not exported from any package entry point.
export function assertNever(_value: never): never {
  throw new Error('Unexpected union variant');
}
