/**
 * Fullscreen Viewer Module (Facade)
 * 
 * Provides 100% backward-compatible exports forwarding to the modular submodules
 * located in ./fullscreen/ (landscape-pan, controls, fit, cinema-pan, gestures, zoom-pan, lifecycle).
 */

export * from './fullscreen/index.js';
export { default } from './fullscreen/index.js';
