const { runComicTagger } = require('./server/services/tagger.js');
// Need a way to run this without throwing errors from fetch and db, but the code in runComicTagger is tightly coupled.
