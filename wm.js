'use strict';

const path = require ('path');
const service = require ('./lib/service.js');

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  const xUtils = require ('xcraft-core-utils');
  return {
    handlers: service,
    rc: xUtils.json.fromFile (path.join (__dirname, './rc.json')),
  };
};
