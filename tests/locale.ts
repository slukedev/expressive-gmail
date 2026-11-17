// Tests that expect en-US dates and numbers run only there; CI also runs the suite in another locale.
export const usEnglish = Intl.DateTimeFormat().resolvedOptions().locale === 'en-US';
