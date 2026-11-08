import { createRoot } from 'react-dom/client';
import { App } from '../../app/App';
import { loadFonts } from '../../app/theme/fonts';
import '../../app/theme/tokens.css';
import '../../app/ui/ui.css';
import '../../app/app.css';

void loadFonts();
createRoot(document.getElementById('root')!).render(<App />);
