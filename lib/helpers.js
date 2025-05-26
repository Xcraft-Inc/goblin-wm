'use strict';

/**
 * Retrieves the BrowserWindow session in use
 * - If a custom session is defined in xcraft config (f.i. from a partition), the custom session is returned
 * - Otherwise the default session is returned
 * @returns {any} The session to use for the browserWindow
 */
function getWindowSession() {
  const {session} = require('electron');
  const xConfigWM = require('xcraft-core-etc')().load('goblin-wm');

  const customPartition = xConfigWM?.windowOptions?.webPreferences?.partition;
  if (customPartition) {
    return session.fromPartition(
      customPartition.replaceAll('$PROCESS_PID', process.pid)
    );
  }

  return session.defaultSession;
}

module.exports = {
  getWindowSession,
};
