const Goblin = require('xcraft-core-goblin');

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return Goblin.buildQueueWorker('window-creator-queue', {
    workQuest: function* (
      quest,
      desktopId,
      labId,
      winId,
      url,
      clientSessionId,
      config,
      forDesktopId
    ) {
      const win = yield quest.createFor(labId, labId, 'wm', {
        id: winId,
        desktopId: forDesktopId,
        url,
        labId: quest.goblin.id,
        clientSessionId,
        feeds: config.feeds,
        options: {
          openDevTools: process.env.WESTEROS_DEVTOOLS === '1',
          useWS: config.useWS,
          target: config.target,
          title: config.title,
          //enableTestAutomationLogguer: true,
        },
      });
      const titlebarInfos = yield win.getTitlebar();
      if (titlebarInfos) {
        const {titlebar, titlebarId} = titlebarInfos;
        yield quest.me.setTitlebar({titlebar, titlebarId});
      }
      yield win.feedSub({desktopId, feeds: config.feeds});
      yield win.beginRender();
    },
  });
};
