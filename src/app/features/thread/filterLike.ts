/** Where Gmail's "Filter messages like these" goes. */
export function filterLikeThese(email: string) {
  window.dispatchEvent(new CustomEvent('bg:advanced-search', { detail: `from:${email}` }));
}
