'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const {fromJS} = require ('immutable');
const transit = require ('transit-immutable-js');
const {BrowserWindow, ipcMain} = require ('electron');

const goblinName = path.basename (module.parent.filename, '.js');

// Define initial logic values
const logicState = {
  instances: {},
  feedSubscriptions: {},
};

// Define logic handlers according rc.json
const logicHandlers = {
  'win.create': (state, action) => {
    const wid = action.get ('wid');
    const win = action.get ('win');
    return state.set (`instances.wid-${wid}`, win);
  },
  _saveUnsubscribe: (state, action) => {
    return state.set (
      `feedSubscriptions.wid-${action.get ('wid')}`,
      action.get ('unsub')
    );
  },
  'win.delete': (state, action) => {
    const wid = action.get ('wid');
    const newState = state
      .del (`instances.wid-${wid}`)
      .del (`feedSubscriptions.wid-${wid}`);

    return newState;
  },
};

const sendBackendState = (window, state) => {
  window.webContents.send ('NEW_BACKEND_STATE', state, 'main');
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

Goblin.registerQuest (goblinName, 'win.create', function* (quest, msg, next) {
  const win = new BrowserWindow ();

  const wid = win.id;
  quest.do ({win: win, wid: wid});

  const nextLoad = next.parallel ();
  const unsubLoad = quest.sub (`wm.win.${wid}.loaded`, (...args) => {
    unsubLoad ();
    return nextLoad (...args);
  });

  win.on ('close', evt => {
    evt.preventDefault ();
    quest.cmd ('wm.win.delete', {wid});
  });

  //wire finish load
  win.webContents.once ('did-finish-load', () => {
    quest.evt (`win.${wid}.loaded`);
  });

  win.loadURL (msg.get ('url'));

  // wait finish load
  yield next.sync ();

  return wid;
});

Goblin.registerQuest (goblinName, 'win.feed.sub', function (quest, msg) {
  // wire backend feeds
  const wid = msg.get ('wid');
  const feeds = msg.get ('feeds');

  const win = quest.goblin.getState ().get (`instances.wid-${wid}`);
  const winFeed = wid;

  const unsubFeed = quest.sub (`warehouse.${winFeed}.changed`, (err, msg) => {
    quest.log.info (`${winFeed} changed`);
    sendBackendState (win, msg.data);
  });

  quest.dispatch ('_saveUnsubscribe', {wid: wid, unsub: unsubFeed});

  quest.cmd ('warehouse.subscribe', {
    feed: winFeed,
    branches: feeds,
  });
});

Goblin.registerQuest (goblinName, 'win.nav', function (quest, msg) {
  const state = quest.goblin.getState ();
  const route = msg.get ('route');
  const wid = msg.get ('wid');
  const win = state.get (`instances.wid-${wid}.`);
  if (win) {
    quest.log.info (`navigating to ${route}...`);
    sendPushPath (win, route);
  }
});

Goblin.registerQuest (goblinName, 'win.delete', function (quest, msg) {
  const state = quest.goblin.getState ();
  const wid = msg.get ('wid');
  const win = state.get (`instances.wid-${wid}`);
  if (win) {
    win.destroy ();
    state.get (`feedSubscriptions.wid-${wid}`) ();
  } else {
    quest.log.warn (`Window with id:${wid} doesn't exist`);
  }
  quest.do ();
});

Goblin.registerQuest (goblinName, 'win.list', function (quest) {
  const state = quest.goblin.getState ();
  const windows = state.get ('instances').select ((v, k) => k);
  quest.log.info (windows.join (', '));
});

// Singleton
const quests = Goblin.configure (goblinName, logicState, logicHandlers);
Goblin.createSingle (goblinName);
module.exports = quests;
