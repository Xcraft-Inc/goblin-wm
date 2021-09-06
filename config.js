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
  {
    type: 'confirm',
    name: 'disableSplash',
    message: 'disable splash screen',
    default: false,
  },
  {
    type: 'input',
    name: 'splashDelay',
    message: 'delay to apply after first window appear',
    default: 1000,
  },
];
