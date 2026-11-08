// Just the Node APIs the session tests use; the project does not depend on @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:crypto' {
  export function createHash(algorithm: 'sha1'): { update(data: string): { digest(encoding: 'hex'): string } };
}

/** Vitest injects the test file's directory. */
declare const __dirname: string;
