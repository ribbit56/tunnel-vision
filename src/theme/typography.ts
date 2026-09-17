// Self-hosted fonts (CLAUDE.md stack). Importing these registers the @font-face
// rules; nothing else needs to reference the font files directly.
// Latin subset only — the UI copy is English, and the other subsets (greek,
// cyrillic, vietnamese, ...) would otherwise multiply the font payload for
// glyphs this app never uses.
import '@fontsource/alegreya/latin-400.css';
import '@fontsource/alegreya/latin-700.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-700.css';

export const fonts = {
  display: "'Alegreya', serif",
  ui: "'Alegreya Sans', sans-serif",
};

// Timer digits use tabular lining figures so they don't shift width as they
// change (SPEC section 8). Apply this class to any element showing the timer.
export const tabularNumsStyle = 'font-variant-numeric: lining-nums tabular-nums;';
