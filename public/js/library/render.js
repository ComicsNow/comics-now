/**
 * Library Render Module (Facade)
 * 
 * Provides 100% backward-compatible exports forwarding to the modular submodules
 * located in ./render/ (series-sort, series, comics, publishers, root-folders).
 */

export * from './render/index.js';
export { default } from './render/index.js';
