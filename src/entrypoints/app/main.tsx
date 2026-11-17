import { createRoot, type ErrorInfo } from 'react-dom/client';
import { App } from '../../app/App';
import { hostDiag } from '../../app/lib/host';
import { loadFonts } from '../../app/theme/fonts';
import { AppFailed, ErrorBoundary } from '../../app/ui/ErrorBoundary';
import '../../app/theme/tokens.css';
import '../../app/ui/ui.css';
import '../../app/app.css';

function report(kind: string) {
  return (error: unknown, info: ErrorInfo) => {
    console.error(`${kind} render error`, error, info.componentStack);
    hostDiag(`${kind} render error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  };
}

void loadFonts();
createRoot(document.getElementById('root')!, {
  onUncaughtError: report('Uncaught'),
  onCaughtError: report('Caught'),
}).render(
  <ErrorBoundary fallback={() => <AppFailed />}>
    <App />
  </ErrorBoundary>,
);
