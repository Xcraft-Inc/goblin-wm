'use strict';

const path            = require ('path');
const Goblin          = require ('xcraft-core-goblin');
const {fromJS}        = require ('immutable');
const {BrowserWindow} = require ('electron');

const goblinName = path.basename (module.parent.filename, '.js');

// Define initial logic values
const logicState = {
  manager: fromJS ({
    windows: {},
    nextWindowId: 0
  }),
  instances: {
    windows: {}
  }
};

// Define logic handlers according rc.json
const logicHandlers = {
  'win.create': (state, action) => {
    const nextId = state.manager.get ('nextWindowId');
    state.instances[nextId] = action.payload.win;
    state.manager = state.manager.withMutations (s => {
      s.setIn (['windows', String (nextId)], {})
       .set ('nextWindowId', nextId + 1);
    });
    return state;
  },
  'win.delete': (state, action) => {
    delete state.instances[action.meta.wid];
    state.manager = state.manager.deleteIn (['windows', action.meta.wid]);
    return state;
  }
};

// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers);

// Register quest's according rc.json
goblin.registerQuest ('win.create', function (quest) {
  const win = new BrowserWindow ();
  quest.goblin.do ({win});
});

goblin.registerQuest ('win.delete', function (quest, msg) {
  const state = quest.goblin.getState ();
  const win = state.instances[msg.data.wid];
  if (win) {
    win.close ();
  } else {
    quest.log.warn (`Window with id:${msg.data.wid} doesn't exist`);
  }
  quest.goblin.do ();
});

goblin.registerQuest ('win.list', function (quest) {
  const state = quest.goblin.getState ();
  const windows = state.manager.get ('windows').toJS ();
  quest.log.info (windows);
});

module.exports = goblin.quests;
