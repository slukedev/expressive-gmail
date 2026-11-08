import { createContext, useContext } from 'react';

/** An email body can't know its height until its frame has loaded. Bodies report here so the conversation can hold back instead of showing cards that jump. */
export interface BodySizing {
  register(id: string): void;
  /** Went away before reporting. */
  unregister(id: string): void;
  sized(id: string): void;
}

const noop: BodySizing = { register() {}, unregister() {}, sized() {} };

export const BodySizingContext = createContext<BodySizing>(noop);

export const useBodySizing = () => useContext(BodySizingContext);
