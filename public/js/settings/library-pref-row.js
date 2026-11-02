/**
 * Builds a single per-library reading preference row (Manga RTL + Vertical Scroll toggles).
 * Extracted from comics-defaults.js to keep module size comfortably below the 380-line ceiling.
 */
export function buildLibraryPrefRow(libPath, libName, manga, continuous, onToggleChange) {
  const row = document.createElement('div');
  row.className =
    'flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-gray-900/60 rounded-lg border border-gray-800 text-xs';
  row.setAttribute('data-lib-path', libPath);

  const label = document.createElement('div');
  label.className = 'flex-1 min-w-0';
  const name = document.createElement('div');
  name.className = 'font-semibold text-white truncate';
  name.textContent = libName || libPath;
  const pathEl = document.createElement('div');
  pathEl.className = 'text-gray-400 font-mono truncate text-[11px]';
  pathEl.textContent = libPath;
  label.appendChild(name);
  label.appendChild(pathEl);

  const toggles = document.createElement('div');
  toggles.className = 'flex items-center gap-3 shrink-0';

  const mangaLabel = document.createElement('label');
  mangaLabel.className = 'inline-flex items-center gap-1.5 cursor-pointer text-gray-300';
  mangaLabel.title = 'Default to Manga (RTL) mode for this library';
  const mangaCb = document.createElement('input');
  mangaCb.type = 'checkbox';
  mangaCb.className =
    'lib-toggle-manga rounded bg-gray-800 border-gray-700 text-purple-600 focus:ring-0';
  mangaCb.checked = manga;
  mangaCb.addEventListener('change', onToggleChange);
  mangaLabel.appendChild(mangaCb);
  mangaLabel.appendChild(document.createTextNode('Manga'));

  const scrollLabel = document.createElement('label');
  scrollLabel.className = 'inline-flex items-center gap-1.5 cursor-pointer text-gray-300';
  scrollLabel.title = 'Default to Vertical Scroll mode for this library';
  const scrollCb = document.createElement('input');
  scrollCb.type = 'checkbox';
  scrollCb.className =
    'lib-toggle-scroll rounded bg-gray-800 border-gray-700 text-purple-600 focus:ring-0';
  scrollCb.checked = continuous;
  scrollCb.addEventListener('change', onToggleChange);
  scrollLabel.appendChild(scrollCb);
  scrollLabel.appendChild(document.createTextNode('Scroll'));

  toggles.appendChild(mangaLabel);
  toggles.appendChild(scrollLabel);

  row.appendChild(label);
  row.appendChild(toggles);
  return row;
}
