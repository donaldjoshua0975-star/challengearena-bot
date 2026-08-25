const Loki = require('lokijs');

let users;
const db = new Loki('challengearena.db', {
  autoload: true,
  autoloadCallback: databaseInitialize,
  autosave: true,
  autosaveInterval: 4000
});

function databaseInitialize() {
  users = db.getCollection('users');
  if (users === null) {
    users = db.addCollection('users', { indices: ['telegramId'] });
  }
}

function getUser(telegramId, name) {
  if (!users) databaseInitialize();
  let user = users.findOne({ telegramId: telegramId });
  
  if (!user) {
    user = users.insert({
      telegramId: telegramId,
      name: name,
      xp: 0,
      level: 1,
      streak: 0,
      completedChallenges: 0
    });
  } else if (user.name !== name) {
    user.name = name;
    users.update(user);
  }
  return user;
}

function updateUser(user) {
  users.update(user);
}

function getLeaderboard(limit = 10) {
  if (!users) databaseInitialize();
  return users.chain()
    .find()
    .simplesort('xp', true)
    .limit(limit)
    .data();
}

function calculateLevel(xp) {
  return Math.floor(xp / 100) + 1;
}

module.exports = {
  getUser,
  updateUser,
  getLeaderboard,
  calculateLevel
};
