import { createBrowserCapabilityAdapter } from '@uppercut-labs/agent-native/browser';
import { createThemePage } from './theme.mjs';
import './style.css';

const page = createThemePage(document);
const adapter = createBrowserCapabilityAdapter(document);
const button = document.querySelector('#toggle');
const status = document.querySelector('#status');
const support = document.querySelector('#support');
let theme = 'light';

async function setTheme(nextTheme) {
  const result = await page.setTheme(nextTheme);
  if (result.kind !== 'success') {
    status.textContent = 'Theme was not changed.';
    return;
  }
  theme = nextTheme;
  button.textContent = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  status.textContent = 'Theme: ' + theme + '.';
}

button.addEventListener('click', () => {
  void setTheme(theme === 'light' ? 'dark' : 'light');
});

const report = await adapter.sync(page.registry, {
  canExpose: page.canExpose,
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: page.authorization,
  }),
});
support.textContent = report.supported
  ? 'Browser tool registrations: ' + report.registered.length + '.'
  : 'WebMCP is unavailable here; use the human theme control above.';
