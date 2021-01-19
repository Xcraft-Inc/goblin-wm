'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'input',
    name: 'windowOptions',
    message: 'Options for electron BrowserWindow',
    default: null,
  },
  {
    type: 'input',
    name: 'vibrancyOptions',
    message: 'Options for electron BrowserWindow',
    default: null,
  },
  {
    type: 'input',
    name: 'titlebar',
    message: 'Titlebar widget name',
    default: null,
  },
];
