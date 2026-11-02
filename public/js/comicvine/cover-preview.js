/**
 * Comics Now! - ComicVine Cover Preview Modal
 *
 * Displays high-resolution cover preview overlay with animations.
 */

import { escapeHtml } from '../globals.js';

export function openCoverPreviewModal(imageUrl, title) {
  const backdrop = document.createElement('div');
  backdrop.id = 'cover-preview-modal';
  backdrop.className = 'fixed inset-0 flex items-center justify-center bg-black/85 backdrop-blur-xs transition-opacity duration-300 opacity-0';
  backdrop.style.zIndex = '99999';

  const content = document.createElement('div');
  content.className = 'relative max-w-[90vw] max-h-[90vh] bg-gray-900/90 backdrop-blur-md p-3 rounded-2xl border border-gray-800 shadow-2xl flex flex-col items-center transform scale-95 transition-transform duration-300';

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = 'Cover Preview';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => {
    img.onerror = null;
    img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="100%" height="100%" fill="%231f2937"/><rect x="4" y="4" width="292" height="442" fill="none" stroke="%23374151" stroke-width="2" rx="8"/><text x="50%" y="45%" fill="%239ca3af" font-size="18" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">GCD Cover</text><text x="50%" y="55%" fill="%236b7280" font-size="12" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">Cover Image Unavailable Online</text></svg>';
  };
  img.className = 'max-w-full max-h-[75vh] object-contain rounded-xl shadow-inner border border-gray-800';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 focus:outline-hidden transition-colors border border-white/10';
  closeBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  `;

  const caption = document.createElement('div');
  caption.className = 'text-white text-sm font-semibold text-center mt-3 px-4 max-w-md truncate';
  caption.textContent = title;

  content.appendChild(img);
  content.appendChild(caption);
  content.appendChild(closeBtn);
  backdrop.appendChild(content);
  document.body.appendChild(backdrop);

  // Animate in
  setTimeout(() => {
    backdrop.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);

  const closeModal = () => {
    backdrop.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
      backdrop.remove();
    }, 300);
  };

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}
