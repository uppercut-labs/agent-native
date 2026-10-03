const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('#site-nav');
const search = document.querySelector('#site-search');
const results = document.querySelector('#search-results');
const searchForm = document.querySelector('.search');

document.body.classList.add('js-ready');
menuButton.addEventListener('click', () => {
  const open = navigation.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});

document.addEventListener('keydown', (event) => {
  if (
    event.key === '/' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
  ) {
    event.preventDefault();
    search.focus();
  }
  if (event.key === 'Escape' && document.activeElement === search) {
    search.value = '';
    results.hidden = true;
    search.blur();
  }
});

let searchIndex;
async function loadIndex() {
  if (!searchIndex) {
    const response = await fetch(
      new URL('search-index.json', document.querySelector('.brand').href),
    );
    if (!response.ok) throw new Error(`Search index request failed: ${response.status}`);
    searchIndex = await response.json();
  }
  return searchIndex;
}

function resultUrl(url) {
  return new URL(url, document.querySelector('.brand').href).href;
}

let latestQuery = '';
search.addEventListener('input', async () => {
  const query = search.value.trim().toLowerCase();
  latestQuery = query;
  if (!query) {
    results.replaceChildren();
    results.hidden = true;
    return;
  }
  try {
    const index = await loadIndex();
    if (query !== latestQuery) return;
    const terms = query.split(/\s+/);
    const matches = index
      .filter((item) =>
        terms.every((term) =>
          `${item.title} ${item.summary} ${item.text}`.toLowerCase().includes(term),
        ),
      )
      .slice(0, 12);
    results.replaceChildren();
    for (const item of matches) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      link.href = resultUrl(item.url);
      title.textContent = item.title;
      detail.textContent = `${item.category} · ${item.summary}`;
      link.append(title, detail);
      li.append(link);
      results.append(li);
    }
    if (!matches.length) {
      const li = document.createElement('li');
      li.className = 'no-results';
      li.textContent = 'No matching pages';
      results.append(li);
    }
    results.hidden = false;
  } catch (error) {
    results.replaceChildren();
    const li = document.createElement('li');
    li.className = 'no-results';
    li.textContent = `Search unavailable: ${error.message}`;
    results.append(li);
    results.hidden = false;
  }
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  results.querySelector('a')?.click();
});
