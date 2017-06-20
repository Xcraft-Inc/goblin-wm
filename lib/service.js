'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const {fromJS} = require ('immutable');
const transit = require ('transit-immutable-js');
const {BrowserWindow, ipcMain} = require ('electron');
const diff = require ('immutablediff');
const goblinName = path.basename (module.parent.filename, '.js');

// Define initial logic values
const logicState = {
  instances: {},
  feedSubscriptions: {},
};

// Define logic handlers according rc.json
const logicHandlers = {
  'win.create': (state, action) => {
    const id = action.get ('id');
    const win = action.get ('win');
    return state.set (`instances.wid-${id}`, win);
  },
  _saveUnsubscribe: (state, action) => {
    return state.set (
      `feedSubscriptions.wid-${action.get ('id')}`,
      action.get ('unsub')
    );
  },
  'win.delete': (state, action) => {
    const id = action.get ('id');
    const newState = state
      .del (`instances.wid-${id}`)
      .del (`feedSubscriptions.wid-${id}`);

    return newState;
  },
};

const previousStates = {};
const fullStateNeeded = {};
const sendBackendState = (window, state) => {
  let payload;
  if (previousStates[window.id] && !fullStateNeeded[window.id]) {
    payload = diff (previousStates[window.id], state);
  } else {
    payload = diff (fromJS ({}), state);
    fullStateNeeded[window.id] = false;
  }
  previousStates[window.id] = state;
  window.webContents.send (
    'NEW_BACKEND_STATE',
    transit.toJSON (payload),
    'main'
  );
};

const sendPushPath = (window, path) => {
  window.webContents.send ('PUSH_PATH', path, 'main');
};

let onLaboratoryReady;
let onQuest;
let onResend;

Goblin.registerQuest (goblinName, 'init', function (quest) {
  onLaboratoryReady = (evt, id, wid) => {
    quest.cmd ('laboratory._ready', {id, wid});
  };

  onQuest = (evt, action) => {
    quest.cmd (action.cmd, action.args);
  };

  onResend = (evt, wid) => {
    quest.cmd ('warehouse.resend', {
      feed: wid,
    });
    fullStateNeeded[wid] = true;
  };

  ipcMain.on ('LABORATORY_READY', onLaboratoryReady);
  ipcMain.on ('QUEST', onQuest);
  ipcMain.on ('RESEND', onResend);
});

Goblin.registerQuest (goblinName, 'uninit', function (quest) {
  // Move in uninit quest ?
  ipcMain.removeListener ('LABORATORY_READY', onLaboratoryReady);
  ipcMain.removeListener ('QUEST', onQuest);
  ipcMain.removeListener ('RESEND', onResend);
});

Goblin.registerQuest (goblinName, 'win.create', function* (quest, url, next) {
  const win = new BrowserWindow ();
  win.webContents.openDevTools ();
  const id = win.id;
  quest.do ({win: win, id});

  const nextLoad = next.parallel ();
  const unsubLoad = quest.sub (`wm.win.${id}.loaded`, (...args) => {
    unsubLoad ();
    return nextLoad (...args);
  });

  win.on ('close', evt => {
    evt.preventDefault ();
    quest.cmd ('wm.win.delete', {id});
  });

  //wire finish load
  win.webContents.once ('did-finish-load', () => {
    quest.evt (`win.${id}.loaded`);
  });

  win.loadURL (url);

  // wait finish load
  yield next.sync ();

  return id;
});

Goblin.registerQuest (goblinName, 'win.feed.sub', function (quest, wid, feeds) {
  // wire backend feeds
  const win = quest.goblin.getState ().get (`instances.wid-${wid}`);
  const winFeed = wid;

  const unsubFeed = quest.sub (`warehouse.${winFeed}.changed`, (err, msg) => {
    quest.log.info (`${winFeed} changed`);
    sendBackendState (win, msg.data);
  });

  quest.dispatch ('_saveUnsubscribe', {id: wid, unsub: unsubFeed});

  quest.cmd ('warehouse.subscribe', {
    feed: winFeed,
    branches: feeds,
  });
});

Goblin.registerQuest (goblinName, 'win.nav', function (quest, id, route) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances.wid-${id}`);
  if (win) {
    quest.log.info (`navigating to ${route}...`);
    sendPushPath (win, route);
  }
});

Goblin.registerQuest (goblinName, 'win.delete', function (quest, id) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances.wid-${id}`);
  if (win) {
    win.destroy ();
    delete fullStateNeeded[id];
    delete previousStates[id];
    state.get (`feedSubscriptions.wid-${id}`) ();
  } else {
    quest.log.warn (`Window with id:${id} doesn't exist`);
  }
  quest.do ();
});

Goblin.registerQuest (goblinName, 'win.list', function (quest) {
  const state = quest.goblin.getState ();
  const windows = state.get ('instances').select ((k, v) => k);
  quest.log.info (windows.join (', '));
});

// Singleton
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
Goblin.createSingle (goblinName);
