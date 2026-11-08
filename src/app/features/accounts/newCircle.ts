import { create } from 'zustand';

/** For the account menu and the palette. Settings keeps its own. */
export const useNewCircle = create<{ open: boolean }>(() => ({ open: false }));

export function openNewCircle() {
  useNewCircle.setState({ open: true });
}

export function closeNewCircle() {
  useNewCircle.setState({ open: false });
}
