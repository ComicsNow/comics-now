/**
 * Comics Now! - Core Application Constants
 *
 * SVG icons and CSS utility class bundles.
 */

export const ICONS = {
  READ: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`,
  UNREAD: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`,
  DOWNLOAD: `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>`,
};

export const CSS_CLASSES = {
  CARD: 'bg-gray-800 rounded-lg shadow-lg cursor-pointer',
  INPUT: 'bg-gray-700 text-white p-2 rounded-lg',
  BUTTON_PRIMARY: 'bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full',
  BUTTON_SECONDARY: 'bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg',
  LOADING: 'bg-gray-800 rounded-lg p-6 text-center text-gray-500 animate-pulse col-span-full',
  ERROR: 'bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full',
  DOWNLOAD_BTN: 'download-btn absolute top-2 right-2 text-green-400 pointer-events-none'
};
