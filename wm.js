'use strict';

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: require ('./lib/service.js'),
    rc: {
      init: {
        parallel: true,
        desc: 'Init window manager',
        options: {
          params: {},
        },
      },
      'win.nav': {
        parallel: true,
        desc: 'Navigate to a route',
        options: {
          params: {
            required: 'wid',
            optional: 'route',
          },
        },
      },
      'win.create': {
        parallel: true,
        desc: 'Open a new window',
        options: {
          params: {
            required: 'wid',
            optional: 'feeds...',
          },
        },
      },
      'win.feed.sub': {
        parallel: true,
        desc: 'Open a new window',
        options: {
          params: {
            required: 'wid',
            optional: 'feeds...',
          },
        },
      },
      'win.delete': {
        parallel: true,
        desc: 'Delete window',
        options: {
          params: {
            required: 'wid',
          },
        },
      },
      'win.list': {
        parallel: true,
        desc: 'List managed windows',
        options: {
          params: {},
        },
      },
    },
  };
};
