require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Loki = require('lokijs');

// ==========================================
// 1. CONFIGURATION & DATABASE SETUP
// ==========================================

const TOKEN = process.env.TELEGRAM_TOKEN;

if (!TOKEN || TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error("❌ ERROR: Please specify a valid TELEGRAM_TOKEN inside your .env file!");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

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
  console.log("📂 Local database loaded successfully.");
}

// Data Handlers
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

// ==========================================
// 2. CHALLENGES DATASTORE
// ==========================================

const challenges = [
  // 🧠 Brain
  {
    id: "b1",
    category: "Brain 🧠",
    title: "Riddle of the Key",
    task: "What has a key, but no locks; space, but no room; and you can enter, but not go in?",
    options: ["Keyboard", "Memory Card", "Map", "Library"],
    correctIndex: 0,
    xpReward: 30
  },
  {
    id: "b2",
    category: "Brain 🧠",
    title: "Quick Math",
    task: "Solve quickly: What is 12 x 8 - 16?",
    options: ["70", "80", "96", "88"],
    correctIndex: 1,
    xpReward: 25
  },
  // 💪 Fitness
  {
    id: "f1",
    category: "Fitness 💪",
    title: "Push-Up Set",
    task: "Do 15 push-ups right now! Tap completed when you finish.",
    options: ["Completed!", "I give up"],
    correctIndex: 0,
    xpReward: 40
  },
  {
    id: "f2",
    category: "Fitness 💪",
    title: "Plank Hold",
    task: "Hold a plank position for 45 seconds!",
    options: ["Done! Held for 45s", "Failed"],
    correctIndex: 0,
    xpReward: 35
  },
  // 📚 Learning
  {
    id: "l1",
    category: "Learning 📚",
    title: "Vocabulary Check",
    task: "What does the word 'Ebullient' mean?",
    options: ["Sad", "Overflowing with excitement", "Confused", "Lazy"],
    correctIndex: 1,
    xpReward: 30
  },
  // 😂 Fun
  {
    id: "u1",
    category: "Fun 😂",
    title: "Straight Face Test",
    task: "Try not to smile or laugh for 60 seconds looking in a mirror!",
    options: ["Kept a straight face!", "Laughed instantly"],
    correctIndex: 0,
    xpReward: 20
  }
];

// ==========================================
// 3. UI MENUS
// ==========================================

function getMainMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎯 Daily Challenge", callback_data: "random_challenge" },
          { text: "⚔️ Challenge Friends", callback_data: "challenge_friend" }
        ],
        [
          { text: "🎲 Random Challenge", callback_data: "random_challenge" },
          { text: "📚 Categories", callback_data: "view_categories" }
        ],
        [
          { text: "🏆 Leaderboard", callback_data: "leaderboard" },
          { text: "📊 Profile Stats", callback_data: "my_profile" }
        ]
      ]
    }
  };
}

// ==========================================
// 4. COMMAND HANDLERS
// ==========================================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  getUser(msg.from.id, msg.from.first_name);

  const welcomeMessage = 
`🔥 *Welcome to ChallengeArena Bot!* ⚔️

Are you ready to test your brain, body, and limits? Step into the arena and complete daily tasks to level up and dominate the leaderboard!

🚀 *What you can do here:*
🎯 *Daily & Random Challenges* — Brain puzzles, fitness tasks & fun routines
⚔️ *Challenge Friends* — Send direct challenges to Telegram friends
🔥 *Streaks & Levels* — Build consecutive streaks, gain XP, and level up
🏆 *Leaderboards* — Compete for the ultimate top spot

Your arena journey starts now. Pick your action below! 👇`;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
});

// ==========================================
// 5. INLINE CALLBACK HANDLERS
// ==========================================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const user = getUser(userId, query.from.first_name);
  const data = query.data;

  // Random / Daily Challenge
  if (data === 'random_challenge') {
    sendChallenge(chatId, messageId);
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Evaluate Answer / Completion
  if (data.startsWith('chk_')) {
    const [, challengeId, selectedIdxStr] = data.split('_');
    const selectedIdx = parseInt(selectedIdxStr, 10);
    const item = challenges.find(c => c.id === challengeId);

    if (!item) {
      bot.answerCallbackQuery(query.id, { text: "Challenge expired." });
      return;
    }

    const isSuccess = selectedIdx === item.correctIndex;

    let responseMsg = "";
    if (isSuccess) {
      user.completedChallenges += 1;
      user.streak += 1;
      user.xp += item.xpReward;
      
      const newLevel = calculateLevel(user.xp);
      let levelUpMsg = "";
      if (newLevel > user.level) {
        user.level = newLevel;
        levelUpMsg = `\n🏅 *LEVEL UP!* You are now Level ${user.level}!`;
      }

      responseMsg = 
`✅ *Challenge Completed!*

⭐ +${item.xpReward} XP Earned
🔥 Streak: *${user.streak} days*
📊 Level: *${user.level}* (Total XP: ${user.xp})${levelUpMsg}`;
    } else {
      user.streak = 0;
      responseMsg = `❌ *Challenge Failed!*\n\n🔥 Streak reset to 0. Try another one!`;
    }

    updateUser(user);

    const postKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎲 Another Challenge", callback_data: "random_challenge" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ]
      }
    };

    bot.editMessageText(responseMsg, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...postKeyboard
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Categories
  if (data === 'view_categories') {
    const categoryText = 
`📚 *Challenge Categories*

🧠 *Brain Challenges* — Logic puzzles & riddles
💪 *Fitness Challenges* — Bodyweight activities
📚 *Learning Challenges* — Trivia & vocabulary
😂 *Fun Challenges* — Humor & entertainment

Select *Random Challenge* to begin!`;

    bot.editMessageText(categoryText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎲 Take a Challenge", callback_data: "random_challenge" }],
          [{ text: "🔙 Back", callback_data: "main_menu" }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Leaderboard
  if (data === 'leaderboard') {
    const topUsers = getLeaderboard(10);
    let leaderboardText = "🏆 *ChallengeArena Leaderboard*\n\n";

    if (topUsers.length === 0) {
      leaderboardText += "No players logged yet. Be the first!";
    } else {
      topUsers.forEach((u, idx) => {
        const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "👤";
        leaderboardText += `${medal} *${u.name}* — Lvl ${u.level} | ${u.xp} XP (🔥 ${u.streak})\n`;
      });
    }

    bot.editMessageText(leaderboardText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back", callback_data: "main_menu" }]]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Profile Stats
  if (data === 'my_profile') {
    const profileText = 
`📊 *Arena Profile: ${user.name}*

🏅 Level: *${user.level}*
⭐ Total XP: *${user.xp}*
🔥 Current Streak: *${user.streak} days*
🎯 Completed Tasks: *${user.completedChallenges}*`;

    bot.editMessageText(profileText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Share Score", switch_inline_query: `I'm Level ${user.level} with ${user.xp} XP on ChallengeArena Bot! 🔥` }],
          [{ text: "🔙 Back", callback_data: "main_menu" }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Challenge Friends
  if (data === 'challenge_friend') {
    const shareText = "⚔️ *Challenge Your Friends*\n\nTap below to send a ChallengeArena invitation to a friend or group!";
    bot.editMessageText(shareText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Send Challenge to Friend", switch_inline_query: "I challenge you to step into the ChallengeArena! ⚔️" }],
          [{ text: "🔙 Back", callback_data: "main_menu" }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Main Menu
  if (data === 'main_menu') {
    bot.editMessageText("🔥 *ChallengeArena Main Menu* ⚔️", {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard()
    });
    bot.answerCallbackQuery(query.id);
    return;
  }
});

// ==========================================
// 6. HELPER FUNCTIONS
// ==========================================

function sendChallenge(chatId, messageIdToEdit = null) {
  const randomChallenge = challenges[Math.floor(Math.random() * challenges.length)];

  const optionsButtons = randomChallenge.options.map((opt, index) => {
    return [{ text: opt, callback_data: `chk_${randomChallenge.id}_${index}` }];
  });

  const bodyText = 
`Category: *${randomChallenge.category}*
Title: *${randomChallenge.title}*
Reward: ⭐ *${randomChallenge.xpReward} XP*

📋 *Task:*
${randomChallenge.task}`;

  const payload = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: optionsButtons
    }
  };

  if (messageIdToEdit) {
    bot.editMessageText(bodyText, {
      chat_id: chatId,
      message_id: messageIdToEdit,
      ...payload
    });
  } else {
    bot.sendMessage(chatId, bodyText, payload);
  }
}

bot.on('polling_error', (err) => console.error(`[Polling Error]: ${err.message}`));
console.log("🚀 ChallengeArena Bot server running...");
