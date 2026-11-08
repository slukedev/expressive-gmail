import { backend } from './client';
import type { BackendCapabilities } from './types';
import type { BackendKind } from './backend';

export function useBackendKind(): BackendKind {
  return backend().kind;
}

export function useCapabilities(): BackendCapabilities {
  return backend().capabilities;
}
