/**
 * Backward-compatible forwarding facade for ComicTagger submodules.
 * Submodules are located under ./comictagger/
 */
export * from './comictagger/index.js';
import * as ComicTagger from './comictagger/index.js';
export default ComicTagger;
