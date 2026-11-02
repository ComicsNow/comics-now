const { dbAll } = require('./connection');
const { checkComicAccess: checkAccessLogic } = require('../access-control');

/**
 * Check if user has access to a specific comic
 * Uses hierarchical access control: root_folder -> publisher -> series
 */
async function checkComicAccess(options) {
  return checkAccessLogic({ ...options, dbAllFunc: dbAll });
}

module.exports = {
  checkComicAccess
};
