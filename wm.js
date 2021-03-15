//pre-load window-manager
require('./lib/wm.js');
/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return require('./lib/service.js');
};
