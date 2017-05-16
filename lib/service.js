'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const {fromJS} = require ('immutable');
const transit = require ('transit-immutable-js');
const {BrowserWindow, ipcMain} = require ('electron');

const goblinName = path.basename (module.parent.filename, '.js');

// Define initial logic values
const logicState = new Goblin.Shredder ({
  manager: {
    windows: {},
  },
  instances: {},
  feedSubscriptions: {},
});

// Define logic handlers according rc.json
const logicHandlers = {
  'win.create': (state, action) => {
    const wid = action.get ('wid');
    const win = action.get ('win');
    const newState = state
      .set (`instances[${wid}]`, win)
      .set (`manager.windows[${wid}]`, {
        id: wid,
        createdAt: new Date (),
      });

    return newState;
  },
  _saveUnsubscribe: (state, action) => {
    return state.set (
      `feedSubscriptions.${action.get ('wid')}`,
      action.get ('unsub')
    );
  },
  'win.delete': (state, action) => {
    const wid = action.get ('wid');
    const newState = state
      .del (`instances[${wid}]`)
      .del (`manager.windows[${wid}]`)
      .del (`feedSubscriptions.${wid}`);

    return newState;
  },
};

const sendBackendState = (window, state) => {
  window.webContents.send ('NEW_BACKEND_STATE', state, 'main');
};

const sendPushPath = (window, path) => {
  window.webContents.send ('PUSH_PATH', path, 'main');
};

// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers);
let resendEnabled = false;

let onFrontEndReady;
let onLaboratoryReady;
let onQuest;
let onResend;

goblin.registerQuest ('init', function (quest) {
  // Move in init quest ?
  onFrontEndReady = (evt, wid) => {
    quest.evt (`win.${wid}.ready`);
    if (resendEnabled) {
      const winFeed = `window_${wid}_feed`;
      quest.cmd ('warehouse.resend', {
        feedName: winFeed,
      });
    }
  };

  onLaboratoryReady = (evt, wid) => {
    quest.evt (`win.${wid}.labready`);
  };

  onQuest = (evt, action) => {
    quest.cmd (action.cmd, action.args);
  };

  onResend = (evt, wid) => {
    const winFeed = `window_${wid}_feed`;
    quest.cmd ('warehouse.resend', {
      feedName: winFeed,
    });
  };

  ipcMain.on ('FRONT_END_READY', onFrontEndReady);
  ipcMain.on ('LABORATORY_READY', onLaboratoryReady);
  ipcMain.on ('QUEST', onQuest);
  ipcMain.on ('RESEND', onResend);
});

goblin.registerQuest ('uninit', function (quest) {
  // Move in uninit quest ?
  ipcMain.removeListener ('FRONT_END_READY', onFrontEndReady);
  ipcMain.removeListener ('LABORATORY_READY', onLaboratoryReady);
  ipcMain.removeListener ('QUEST', onQuest);
  ipcMain.removeListener ('RESEND', onResend);
});

goblin.registerQuest ('win.create', function* (quest, msg, next) {
  const uuidV4 = require ('uuid/v4');

  const win = new BrowserWindow ();

  const state = quest.goblin.getState ();
  const wid = msg.get ('wid') || uuidV4 ();
  quest.goblin.do ({win: win, wid: wid});

  const unsubLoad = quest.sub (`wm.win.${wid}.loaded`, next.parallel ());
  //wire finish load
  win.webContents.on ('did-finish-load', () => {
    quest.evt (`win.${wid}.loaded`);
    if (resendEnabled) {
      sendBackendState (win, transit.toJSON (fromJS ({wid: wid})));
    }
  });
  win.loadURL (msg.get ('url'));

  // wait finish load
  yield next.sync ();
  //unsubLoad ();
  sendBackendState (win, transit.toJSON (fromJS ({wid: wid})));
  resendEnabled = true;
  // wire backend feeds
  const winFeed = `window_${wid}_feed`;
  const feeds = msg.get ('feeds');
  const unsubFeed = quest.sub (`warehouse.${winFeed}.changed`, (err, msg) => {
    quest.log.info ('winFeed changed:');
    sendBackendState (win, msg.data);
  });

  quest.dispatch ('_saveUnsubscribe', {wid: wid, unsub: unsubFeed});

  yield quest.cmd ('warehouse.subscribe', {
    feed: winFeed,
    branches: feeds,
  });

  return {wid};
});

goblin.registerQuest ('win.nav', function (quest, msg) {
  const route = msg.get ('route');
  const wid = msg.get ('wid');
  const win = state.get (`instances[${wid}]`);
  if (win) {
    quest.log.info (`navigating to ${route}...`);
    sendPushPath (win, route);
  }
});

goblin.registerQuest ('win.delete', function (quest, msg) {
  const state = quest.goblin.getState ();
  const wid = msg.get ('wid');
  const win = state.get (`instances[${wid}]`);
  if (win) {
    win.close ();
    state.get (`feedSubscriptions.${wid}`) ();
  } else {
    quest.log.warn (`Window with id:${wid} doesn't exist`);
  }
  quest.goblin.do ();
});

goblin.registerQuest ('win.list', function (quest) {
  const state = quest.goblin.getState ();
  const windows = state.get ('manager.windows').toJS ();
  quest.log.info (windows);
});

module.exports = goblin.quests;
