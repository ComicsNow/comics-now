/**
 * Story Arcs & Reading Orders Configuration Accessors
 */
function createStoryArcsConfigAccessors(config, saveConfigToDisk) {
  function getReadingOrdersIntervalDays() {
    if (config.readingOrdersIntervalDays === undefined || config.readingOrdersIntervalDays === null) {
      return 7;
    }
    const num = Number(config.readingOrdersIntervalDays);
    return Number.isFinite(num) ? Math.max(0, Math.min(90, Math.round(num))) : 7;
  }

  function setReadingOrdersIntervalDays(days, skipSave = false) {
    const num = Number(days);
    const sanitized = Number.isFinite(num) ? Math.max(0, Math.min(90, Math.round(num))) : 7;
    config.readingOrdersIntervalDays = sanitized;
    if (!skipSave && typeof saveConfigToDisk === 'function') {
      saveConfigToDisk();
    }
    return sanitized;
  }

  function getReadingOrdersMode() {
    const mode = config.readingOrdersMode;
    const allowed = ['both', 'issues', 'collected'];
    return allowed.includes(mode) ? mode : 'both';
  }

  function setReadingOrdersMode(mode, skipSave = false) {
    const allowed = ['both', 'issues', 'collected'];
    const sanitized = allowed.includes(mode) ? mode : 'both';
    config.readingOrdersMode = sanitized;
    if (!skipSave && typeof saveConfigToDisk === 'function') {
      saveConfigToDisk();
    }
    return sanitized;
  }

  return {
    getReadingOrdersIntervalDays,
    setReadingOrdersIntervalDays,
    getReadingOrdersMode,
    setReadingOrdersMode
  };
}

module.exports = {
  createStoryArcsConfigAccessors
};
