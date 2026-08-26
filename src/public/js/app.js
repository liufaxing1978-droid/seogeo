document.documentElement.classList.add('js');

const shell = document.querySelector('[data-ui="app-shell"]');
const sidebar = document.querySelector('#primary-navigation');
const toggle = document.querySelector('[data-ui="nav-toggle"]');
const closeButton = document.querySelector('[data-ui="nav-close"]');
const backdrop = document.querySelector('[data-ui="nav-backdrop"]');
const desktop = window.matchMedia('(min-width: 1024px)');
let restoreFocus = null;

function setNavigationOpen(open) {
  if (!shell || !toggle || !sidebar) return;
  shell.classList.toggle('nav-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('nav-locked', open);
  if (open) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : toggle;
    closeButton?.focus();
  } else if (restoreFocus instanceof HTMLElement) {
    restoreFocus.focus();
    restoreFocus = null;
  }
}

toggle?.addEventListener('click', () => setNavigationOpen(true));
closeButton?.addEventListener('click', () => setNavigationOpen(false));
backdrop?.addEventListener('click', () => setNavigationOpen(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shell?.classList.contains('nav-open')) setNavigationOpen(false);
});

desktop.addEventListener('change', (event) => {
  if (event.matches) setNavigationOpen(false);
});
