const Goblin = require('xcraft-core-goblin');

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function() {
  return Goblin.buildQueue('window-creator-queue', {
    sub: '*::*.<create-window-requested>',
    queueSize: 1,
  });
};
