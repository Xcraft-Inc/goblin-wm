'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const {BrowserWindow} = require ('electron');

const goblinName = path.basename (module.parent.filename, '.js');

// Define initial logic values
const logicState = new Goblin.Shredder ({
  manager: {
    windows: [],
    nextWindowId: 0,
  },
  instances: [],
});

// Define logic handlers according rc.json
const logicHandlers = {
  'win.create': (state, action) => {
    const nextId = state.get ('manager.nextWindowId');

    const newState = state
      .set (`instances[${nextId}]`, action.payload.win)
      .set (`manager.windows[${nextId}]`, {
        id: nextId,
        createdAt: new Date (),
      })
      .set ('manager.nextWindowId', nextId + 1);

    return newState;
  },
  'win.delete': (state, action) => {
    const newState = state
      .del (`instances[${action.meta.wid}]`)
      .del (`manager.windows[${action.meta.wid}]`);

    return newState;
  },
};

// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers);

// Register quest's according rc.json
goblin.registerQuest ('win.create', function (quest, msg) {
  const win = new BrowserWindow ();
  quest.goblin.do ({win});
  win.loadURL (msg.get ('url'));
});

goblin.registerQuest ('win.delete', function (quest, msg) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances[${msg.data.wid}]`);
  if (win) {
    win.close ();
  } else {
    quest.log.warn (`Window with id:${msg.data.wid} doesn't exist`);
  }
  quest.goblin.do ();
});

goblin.registerQuest ('win.list', function (quest) {
  const state = quest.goblin.getState ();
  const windows = state.get ('manager.windows').toJS ();
  quest.log.info (windows);
});

module.exports = goblin.quests;
