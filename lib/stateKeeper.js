const appConfig = require('electron-settings');

function windowStateKeeper(windowName) {
  let window, windowState;

  function setBounds() {
    // Restore from appConfig
    if (appConfig.has(`windowState.${windowName}`)) {
      windowState = appConfig.get(`windowState.${windowName}`);
      return;
    }
    // Default
    windowState = {
      windowOptions: undefined,
    };
  }

  function saveState() {
    if (!windowState.isMaximized) {
      windowState.windowOptions = window.getBounds();
    }
    windowState.windowOptions.isMaximized = window.isMaximized();
    appConfig.set(`windowState.${windowName}`, windowState);
  }

  function track(win) {
    window = win;
    ['resize', 'move', 'close'].forEach(event => {
      win.on(event, saveState);
    });
  }

  setBounds();

  return {
    windowOptions: windowState.windowOptions,
    track,
  };
}

function cleanStateKeeper() {
  appConfig.deleteAll();
}

function goblinStateKeeper(goblinName, events) {
  let goblinEvents;

  function setInitialState() {
    // Restore from appConfig
    if (appConfig.has(`goblinState.${goblinName}`)) {
      goblinEvents = appConfig.get(`goblinState.${goblinName}`);
      return;
    }
    // Default
    goblinEvents = [];
  }

  function saveState(event) {
    goblinEvents.push(event);
    appConfig.set(`goblinState.${goblinName}`, goblinEvents);
  }

  function track(goblin) {
    events.forEach(event => {
      goblin.on(event, saveState(event));
    });
  }

  setInitialState();

  return {
    goblinEvents,
    track,
  };
}

module.exports = {windowStateKeeper, goblinStateKeeper, cleanStateKeeper};
