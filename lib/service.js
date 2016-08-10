'use strict';

const path = require ('path');
const goblinName = path.basename (module.parent.filename, '.js');
const Goblin   = require ('xcraft-core-goblin');
const {fromJS} = require ('immutable');
const {BrowserWindow} = require ('electron');

// Define initial logic values
const logicState = fromJS ({
  windows: {},
  nextWindowId: 0
});

// Define logic handlers according rc.json
const logicHandlers = {
  'win.create': (state, action) => {
    return state.withMutations (s => {
      s.setIn (['windows', state.nextWindowId], action.payload.win);
      s.set ('nextWindowId', s.nextWindowId++);
    });
  },
  'win.delete': (state, action) => {
    return state.deleteIn (['windows', action.meta.wid]);
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
  const win = state.getIn (['windows', msg.wid]);
  if (win) {
    win.close ();
  } else {
    quest.log.warn (`Window with id:${msg.wid} doesn't exist`);
  }
  quest.goblin.do ();
});

module.exports = goblin.quests;
