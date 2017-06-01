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
        desc: 'init window manager',
        options: {
          params: {},
        },
      },
      'win.nav': {
        parallel: true,
        desc: 'navigate to a route',
        options: {
          params: {
            required: 'wid',
            optional: 'route',
          },
        },
      },
      'win.create': {
        parallel: true,
        desc: 'open a new window',
        options: {
          params: {
            optional: 'feeds...',
          },
        },
      },
      'win.feed.sub': {
        parallel: true,
        desc: 'subscribe to a feed',
        options: {
          params: {
            required: 'wid',
            optional: 'feeds...',
          },
        },
      },
      'win.delete': {
        parallel: true,
        desc: 'delete a window',
        options: {
          params: {
            required: 'wid',
          },
        },
      },
      'win.list': {
        parallel: true,
        desc: 'list managed windows',
        options: {
          params: {},
        },
      },
    },
  };
};
