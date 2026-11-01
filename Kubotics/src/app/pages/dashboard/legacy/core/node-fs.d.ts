/** Minimal ambient declarations for the Node built-ins the contract test
 * (core/api.spec.ts) uses to grep the feature sources for raw "/api/…" strings.
 * web/ deliberately does NOT ship @types/node (the app code never touches
 * Node APIs) — only these two functions are declared, so an accidental wider
 * use of Node APIs still fails the type-check. */

declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf-8'): string;
  export function statSync(path: string): { isDirectory(): boolean };
}
