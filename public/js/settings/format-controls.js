const ALL_FORMATS = ['cbz', 'cbr', 'pdf', 'epub'];
const CONVERTIBLE_FORMATS = ['cbr', 'pdf', 'epub'];

export function normalizeClientAllowedFormats(value) {
  if (Array.isArray(value)) {
    const out = value
      .map((v) => String(v || '').trim().toLowerCase())
      .filter((v, i, arr) => ALL_FORMATS.includes(v) && arr.indexOf(v) === i);
    return out.length > 0 ? out : ['cbz'];
  }
  const raw = String(value || 'cbz').trim().toLowerCase();
  if (raw === 'both') return ['cbz', 'cbr'];
  if (raw === 'all') return [...ALL_FORMATS];
  if (raw.includes(',')) return normalizeClientAllowedFormats(raw.split(','));
  return ALL_FORMATS.includes(raw) ? [raw] : ['cbz'];
}

export function normalizeClientAutoConvertFormats(value) {
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value.trim()) {
      return normalizeClientAutoConvertFormats(value.split(','));
    }
    return [];
  }
  return value
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v, i, arr) => CONVERTIBLE_FORMATS.includes(v) && arr.indexOf(v) === i);
}

export function applyFormatControlsToDom(data = {}) {
  const allowed = normalizeClientAllowedFormats(data.allowedFormats);
  for (const fmt of ALL_FORMATS) {
    const cb = document.getElementById(`allowed-format-${fmt}`);
    if (cb) cb.checked = allowed.includes(fmt);
  }

  const autoEnabled = data.autoConvertEnabled === true;
  const autoToggle = document.getElementById('auto-convert-enabled-toggle');
  if (autoToggle) autoToggle.checked = autoEnabled;

  const autoFormats = normalizeClientAutoConvertFormats(data.autoConvertFormats);
  for (const fmt of CONVERTIBLE_FORMATS) {
    const cb = document.getElementById(`auto-convert-format-${fmt}`);
    if (cb) cb.checked = autoFormats.includes(fmt);
  }

  const cbrSel = document.getElementById('cbr-conversion-originals-select');
  if (cbrSel) cbrSel.value = data.deleteCbrAfterConversion === true ? 'delete' : 'keep';

  const pdfSel = document.getElementById('pdf-conversion-originals-select');
  if (pdfSel) pdfSel.value = data.deletePdfAfterConversion === true ? 'delete' : 'keep';

  const epubSel = document.getElementById('epub-conversion-originals-select');
  if (epubSel) epubSel.value = data.deleteEpubAfterConversion === true ? 'delete' : 'keep';

  syncAutoConvertOptionsVisibility();
}

export function syncAutoConvertOptionsVisibility() {
  const autoToggle = document.getElementById('auto-convert-enabled-toggle');
  const panel = document.getElementById('auto-convert-formats-panel');
  if (!panel) return;
  const enabled = !!autoToggle?.checked;
  panel.classList.toggle('opacity-50', !enabled);
  panel.querySelectorAll('input, select').forEach((el) => {
    el.disabled = !enabled;
  });
}

export function readFormatControlsFromDom(fallback = {}) {
  const checkedAllowed = ALL_FORMATS.filter(
    (fmt) => !!document.getElementById(`allowed-format-${fmt}`)?.checked
  );
  const allowedFormats = checkedAllowed.length > 0
    ? checkedAllowed
    : normalizeClientAllowedFormats(fallback.allowedFormats || 'cbz');

  const autoToggle = document.getElementById('auto-convert-enabled-toggle');
  const autoConvertEnabled = autoToggle
    ? !!autoToggle.checked
    : Boolean(fallback.autoConvertEnabled);

  const autoConvertFormats = CONVERTIBLE_FORMATS.filter(
    (fmt) => !!document.getElementById(`auto-convert-format-${fmt}`)?.checked
  );

  const cbrSel = document.getElementById('cbr-conversion-originals-select');
  const pdfSel = document.getElementById('pdf-conversion-originals-select');
  const epubSel = document.getElementById('epub-conversion-originals-select');

  return {
    allowedFormats,
    autoConvertEnabled,
    autoConvertFormats,
    deleteCbrAfterConversion: cbrSel ? cbrSel.value === 'delete' : Boolean(fallback.deleteCbrAfterConversion),
    deletePdfAfterConversion: pdfSel ? pdfSel.value === 'delete' : Boolean(fallback.deletePdfAfterConversion),
    deleteEpubAfterConversion: epubSel ? epubSel.value === 'delete' : Boolean(fallback.deleteEpubAfterConversion)
  };
}

export function wireFormatControlListeners(onChange) {
  for (const fmt of ALL_FORMATS) {
    document.getElementById(`allowed-format-${fmt}`)?.addEventListener('change', () => {
      // Prevent unchecking every format: keep at least CBZ checked if user unchecks last one
      const anyChecked = ALL_FORMATS.some((f) => document.getElementById(`allowed-format-${f}`)?.checked);
      if (!anyChecked) {
        const cbz = document.getElementById('allowed-format-cbz');
        if (cbz) cbz.checked = true;
      }
      onChange?.();
    });
  }

  document.getElementById('auto-convert-enabled-toggle')?.addEventListener('change', () => {
    syncAutoConvertOptionsVisibility();
    onChange?.();
  });

  for (const fmt of CONVERTIBLE_FORMATS) {
    document.getElementById(`auto-convert-format-${fmt}`)?.addEventListener('change', () => onChange?.());
    document.getElementById(`${fmt}-conversion-originals-select`)?.addEventListener('change', () => onChange?.());
  }
}
