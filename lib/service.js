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
    windows: [],
  },
  instances: [],
  feedSubscriptions: {},
});

// Define logic handlers according rc.json
const logicHandlers = {
  'win.create': (state, action) => {
    const wid = action.get ('wid');

    const newState = state
      .set (`instances[${wid}]`, action.get ('win'))
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

// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers);

// Register quest's according rc.json
goblin.registerQuest ('_postload', function (quest) {
  ipcMain.on ('FRONT_END_READY', (evt, wid) => {
    quest.evt (`win.${wid}.ready`);
  });

  ipcMain.on ('QUEST', (evt, action) => {
    quest.cmd (action.cmd, action.args);
  });

  ipcMain.on ('RESEND', (evt, wid) => {
    const winFeed = `window_${wid}_feed`;
    quest.cmd ('warehouse.resend', {
      feedName: winFeed,
    });
  });
});

goblin.registerQuest ('win.create', function* (quest, msg, next) {
  const uuidV4 = require ('uuid/v4');

  const win = new BrowserWindow ();

  const state = quest.goblin.getState ();
  const wid = msg.get ('wid') || uuidV4 ();
  quest.goblin.do ({win, wid});

  const unsubLoad = quest.sub (`wm.win.${wid}.loaded`, next.parallel ());
  //wire finish load
  win.webContents.on ('did-finish-load', () => quest.evt (`win.${wid}.loaded`));
  win.loadURL (msg.get ('url'));

  // wait finish load
  yield next.sync ();
  unsubLoad ();
  sendBackendState (win, transit.toJSON (fromJS ({wid: wid})));

  yield quest.sub.wait (`win.${wid}.ready`);
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
