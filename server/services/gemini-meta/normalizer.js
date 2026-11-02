const {
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  normalizePublisher,
  isTitleSameAsSeries,
  cleanDescription,
  resolveCreatorRoles,
  cleanGenreAndTags
} = require('../metadata');

/**
 * Normalizes the parsed Gemini JSON response according to library rules,
 * merging with existing metadata, and constructing a complete dual-cased dictionary.
 *
 * @param {Object} options
 * @param {Object} options.parsed - The raw parsed JSON response from Gemini
 * @param {Object} [options.existingMeta] - Metadata already present in the archive
 * @param {Object} [options.winningCandidate] - The winning candidate match
 * @param {Array<string>} [options.publisherCodex] - User's library publisher names
 * @returns {Object} Normalized metadata dictionary with both PascalCase and lowercase keys
 */
function normalizeGeminiMetadata({
  parsed = {},
  existingMeta = {},
  winningCandidate = {},
  publisherCodex = []
}) {
  const result = { ...parsed };

  // Preserve existing notes if present
  if (existingMeta?.Notes || existingMeta?.notes) {
    result.Notes = existingMeta.Notes || existingMeta.notes;
  }

  // Preserve cover image URL from winning candidate
  const winMeta = winningCandidate?.metadata || winningCandidate || {};
  result.cover_image_url = winMeta.cover_image_url || winMeta.cover_url || winningCandidate?.coverUrl || null;
  result.source_url = result.Web || winMeta.source_url || winningCandidate?.matching_url || '';

  // Local programmatic rule enforcement layer (guarantees consistency with library rules)
  let cleanSeries = result.Series || '';
  let cleanTitle = result.Title || '';
  let cleanNumber = result.Number != null ? String(result.Number).trim() : '';
  let cleanVolume = result.Volume != null ? String(result.Volume).trim() : '';

  try {
    cleanSeries = cleanFormatAndEdition(cleanSeries);
    cleanTitle = cleanFormatAndEdition(cleanTitle);
    result.Genre = cleanGenreAndTags(result.Genre || '');
    if (result.Tags) result.Tags = cleanGenreAndTags(result.Tags);

    // Apply volume/subtitle splitting rules (e.g. "Batman: Vol 1, The Shining")
    const volSplit = splitVolumeSeriesAndTitle(cleanSeries, cleanTitle);
    if (volSplit.series && volSplit.number) {
      cleanSeries = volSplit.series;
      cleanTitle = volSplit.title;
      if (!cleanNumber || cleanNumber === '1' || cleanNumber === '01') {
        cleanNumber = volSplit.number;
      }
      if (!cleanVolume) {
        cleanVolume = volSplit.volume;
      }
    }

    // For graphic novels, TPBs, and collected editions, volume number serves as issue number if Number is blank
    if (!cleanNumber && cleanVolume) {
      cleanNumber = cleanVolume;
    }
    if (!cleanNumber && (existingMeta?.Number || existingMeta?.number)) {
      cleanNumber = String(existingMeta.Number || existingMeta.number).trim();
    }

    if (cleanTitle && (isTitleSameAsSeries(cleanTitle, cleanSeries) || (!cleanSeries && isTitleSameAsSeries(cleanTitle, '')))) {
      cleanTitle = '';
    }

    result.Publisher = normalizePublisher(result.Publisher, publisherCodex);
    result.Summary = cleanDescription(result.Summary || '');

    // Disambiguate creator roles
    const creatorsObj = {
      Writer: result.Writer || existingMeta?.Writer || existingMeta?.writer || '',
      Penciller: result.Penciller || existingMeta?.Penciller || existingMeta?.penciller || '',
      Inker: result.Inker || existingMeta?.Inker || existingMeta?.inker || '',
      Colorist: result.Colorist || existingMeta?.Colorist || existingMeta?.colorist || '',
      Letterer: result.Letterer || existingMeta?.Letterer || existingMeta?.letterer || '',
      CoverArtist: result.CoverArtist || existingMeta?.CoverArtist || existingMeta?.cover_artist || '',
      Editor: result.Editor || existingMeta?.Editor || existingMeta?.editor || '',
      Summary: result.Summary
    };
    resolveCreatorRoles(creatorsObj);
    result.Writer = result.Writer || existingMeta?.Writer || existingMeta?.writer || creatorsObj.Writer || '';
    result.Penciller = result.Penciller || existingMeta?.Penciller || existingMeta?.penciller || creatorsObj.Penciller || '';
    result.Inker = result.Inker || existingMeta?.Inker || existingMeta?.inker || creatorsObj.Inker || '';
    result.Colorist = result.Colorist || existingMeta?.Colorist || existingMeta?.colorist || creatorsObj.Colorist || '';
    result.Letterer = result.Letterer || existingMeta?.Letterer || existingMeta?.letterer || creatorsObj.Letterer || '';
    result.CoverArtist = result.CoverArtist || existingMeta?.CoverArtist || existingMeta?.cover_artist || creatorsObj.CoverArtist || '';
    result.Editor = result.Editor || existingMeta?.Editor || existingMeta?.editor || creatorsObj.Editor || '';
  } catch (_) {}

  result.Series = cleanSeries;
  result.Title = cleanTitle;
  result.Number = cleanNumber;
  result.Volume = cleanVolume;

  const yearStr = result.Year != null ? String(result.Year) : (existingMeta?.Year || existingMeta?.year || '');
  const monthStr = result.Month != null ? String(result.Month) : (existingMeta?.Month || existingMeta?.month || '');
  const dayStr = result.Day != null ? String(result.Day) : (existingMeta?.Day || existingMeta?.day || '');
  const coverDateStr = result.CoverDate || (yearStr ? `${yearStr}${monthStr ? '-' + monthStr.padStart(2, '0') : ''}` : '');

  // Construct dual-cased dictionary: both PascalCase (for ComicInfo.xml) and lowercase (for Python sidecar / tagger.js)
  return {
    // PascalCase
    Title: result.Title || '',
    Series: result.Series || '',
    Number: result.Number || '',
    Volume: result.Volume || '',
    Publisher: result.Publisher || '',
    Imprint: result.Imprint || '',
    Writer: result.Writer || '',
    Penciller: result.Penciller || '',
    Inker: result.Inker || '',
    Colorist: result.Colorist || '',
    Letterer: result.Letterer || '',
    CoverArtist: result.CoverArtist || '',
    Editor: result.Editor || '',
    Summary: result.Summary || '',
    Year: yearStr,
    Month: monthStr,
    Day: dayStr,
    CoverDate: coverDateStr,
    Genre: result.Genre || '',
    Web: result.Web || result.source_url || '',
    Characters: result.Characters || '',
    Teams: result.Teams || '',
    Locations: result.Locations || '',
    StoryArc: result.StoryArc || '',
    StoryArcNumber: result.StoryArcNumber || '',
    PageCount: result.PageCount || '',
    AgeRating: result.AgeRating || '',
    Notes: result.Notes || existingMeta?.Notes || existingMeta?.notes || '',

    // Lowercase / standard keys
    title: result.Title || '',
    series: result.Series || '',
    number: result.Number || '',
    issue: result.Number || '',
    issue_number: result.Number || '',
    issue_title: result.Title || '',
    volume: result.Volume || '',
    publisher: result.Publisher || '',
    imprint: result.Imprint || '',
    description: result.Summary || '',
    summary: result.Summary || '',
    year: yearStr,
    month: monthStr,
    day: dayStr,
    cover_date: coverDateStr,
    publish_date: coverDateStr,
    writer: result.Writer || '',
    penciller: result.Penciller || '',
    inker: result.Inker || '',
    colorist: result.Colorist || '',
    letterer: result.Letterer || '',
    cover_artist: result.CoverArtist || '',
    editor: result.Editor || '',
    genre: result.Genre || '',
    genres: result.Genre ? result.Genre.split(',').map(s => s.trim()).filter(Boolean) : [],
    characters: result.Characters || '',
    teams: result.Teams || '',
    locations: result.Locations || '',
    story_arc: result.StoryArc || '',
    story_arc_number: result.StoryArcNumber || '',
    page_count: result.PageCount || '',
    age_rating: result.AgeRating || '',
    cover_image_url: result.cover_image_url || null,
    source_url: result.source_url || result.Web || '',
    notes: result.Notes || existingMeta?.Notes || existingMeta?.notes || ''
  };
}

module.exports = {
  normalizeGeminiMetadata
};
