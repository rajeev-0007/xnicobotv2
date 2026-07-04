const jsonStore = require('./jsonStore');
const log = require('./logger-styled');


const DEFAULT_USER_DATA = {
  coins: 0,
  bank: 0,
  lastDaily: 0,
  lastWeekly: 0,
  lastWork: 0,
  lastRob: 0,
  bonuses: { work: 0, daily: 0, gamble: 0, global: 0 },
  inventory: [],
  level: 1,
  xp: 0,
  achievements: [],
  streak: 0,
  battlesWon: 0,
  battlesLost: 0,
  fishCaught: 0,
  huntCount: 0,
  title: '',
  adventuresCompleted: 0,
  totalGambled: 0,
  totalWon: 0,
  totalLost: 0,
  lastHunt: 0,
  lastFish: 0,
  lastBattle: 0,
  boosts: {},
  crimeCount: 0,
  workCount: 0,
  miningCount: 0,
  oreInventory: {},
  // crops is a slot-keyed object: `{ slot_<n>: { seedId, plantedAt,
  // readyAt }, ... }`. The legacy default was `[]` (array) and the
  // normaliser below enforced array shape on every load — which
  // wiped out planted crops as soon as `farm.js` populated them
  // with named slot keys.
  crops: {},
  lastMine: 0,
  lastFarm: 0,
  loans: [],
  stockPortfolio: {},
  craftCount: 0,
  heistCount: 0,
  giftsSent: 0,
  harvestCount: 0,
  dailyStreak: 0,
  weeklyClaimCount: 0,
};

/* ═══════════════════════════════════════════════════════
   ACHIEVEMENTS REGISTRY
   ═══════════════════════════════════════════════════════ */

const ACHIEVEMENTS = {
  first_battle: { emoji: '⚔', name: 'First Blood', desc: 'Win your first battle' },
  battle_50: { emoji: '<:Award:1521228119640375336>', name: 'Veteran Warrior', desc: 'Win 50 battles' },
  fisher: { emoji: '🎣', name: 'Master Angler', desc: 'Catch 50 fish' },
  criminal: { emoji: '🦹', name: 'Crime Lord', desc: 'Commit 50 crimes' },
  gambler: { emoji: '🎰', name: 'High Roller', desc: 'Gamble over 1,000,000 coins total' },
  adventurer: { emoji: '🗺', name: 'Explorer', desc: 'Complete 25 adventures' },
  first_mine: { emoji: '⛏', name: 'First Strike', desc: 'Mine for the first time' },
  master_miner: { emoji: '<:Sketch:1521228025365004471>', name: 'Master Miner', desc: 'Mine 100 times' },
  first_heist: { emoji: '<:Bank:1521228286813012169>', name: 'Heist Initiate', desc: 'Complete your first heist' },
  master_crafter: { emoji: '🔨', name: 'Master Crafter', desc: 'Craft 25 items' },
  first_farm: { emoji: '🌾', name: 'Green Thumb', desc: 'Harvest your first crop' },
  generous: { emoji: '🎁', name: 'Generous Soul', desc: 'Gift 10 items to other players' },
  stock_trader: { emoji: '📈', name: 'Stock Trader', desc: 'Buy stocks for the first time' },
};

/* ═══════════════════════════════════════════════════════
   FILE HANDLING — now backed by PostgreSQL via jsonStore
   ═══════════════════════════════════════════════════════ */

function loadEconomy() {
  try {
    // Use peek (no clone) — the caller mutates in-place then calls
    // saveEconomy → markDirty. This avoids the expensive deepClone.
    let data = jsonStore.peek('economy');
    if (!data) {
      // Store doesn't exist yet — seed the cache with an empty object
      // so mutations go to the live cache (not a throwaway {}).
      data = {};
      jsonStore.cache.set('economy', data);
    }
    return data;
  } catch (err) {
    log.error('[ECONOMY] load failed', err);
    return {};
  }
}

function saveEconomy(data) {
  try {
    // Since loadEconomy() returns the live cache reference (via peek),
    // the data IS the cache — no need to clone it back in. Just mark
    // the store dirty so the debounced persist picks it up.
    jsonStore.markDirty('economy');
  } catch (err) {
    log.error('[ECONOMY] save failed', err);
  }
}

/* ═══════════════════════════════════════════════════════
   USER DATA NORMALIZATION
   ═══════════════════════════════════════════════════════ */

function normalizeUserData(data) {
  let changed = false;
  for (const k in DEFAULT_USER_DATA) {
    if (data[k] === undefined) {
      const def = DEFAULT_USER_DATA[k];
      if (Array.isArray(def)) {
        data[k] = [];
      } else if (typeof def === 'object' && def !== null) {
        data[k] = { ...def };
      } else {
        data[k] = def;
      }
      changed = true;
    }
  }
  if (!Array.isArray(data.inventory)) { data.inventory = []; changed = true; }
  if (!Array.isArray(data.achievements)) { data.achievements = []; changed = true; }
  if (!Array.isArray(data.loans)) { data.loans = []; changed = true; }
  // crops is a slot-keyed object — `{ slot_<n>: { seedId, plantedAt,
  // readyAt }, ... }`. If older data has an array (legacy default)
  // or anything that isn't an object, reset it to an empty object.
  if (typeof data.crops !== 'object' || Array.isArray(data.crops) || data.crops === null) {
    data.crops = {};
    changed = true;
  }
  if (typeof data.oreInventory !== 'object' || Array.isArray(data.oreInventory)) { data.oreInventory = {}; changed = true; }
  if (typeof data.stockPortfolio !== 'object' || Array.isArray(data.stockPortfolio)) { data.stockPortfolio = {}; changed = true; }
  if (typeof data.bonuses !== 'object' || data.bonuses === null) {
    data.bonuses = { ...DEFAULT_USER_DATA.bonuses };
    changed = true;
  } else {
    for (const bk in DEFAULT_USER_DATA.bonuses) {
      if (data.bonuses[bk] === undefined) {
        data.bonuses[bk] = DEFAULT_USER_DATA.bonuses[bk];
        changed = true;
      }
    }
  }
  return changed;
}

function getUser(economy, userId) {
  if (!economy[userId]) {
    economy[userId] = JSON.parse(JSON.stringify(DEFAULT_USER_DATA));
    return { userData: economy[userId], changed: true };
  }
  const changed = normalizeUserData(economy[userId]);
  return { userData: economy[userId], changed };
}

/* ═══════════════════════════════════════════════════════
   FORMATTING HELPERS
   ═══════════════════════════════════════════════════════ */

function formatNumber(val) {
  return Number.isFinite(val) ? val.toLocaleString() : '0';
}

function formatTime(ms) {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

/* ═══════════════════════════════════════════════════════
   XP / LEVELING SYSTEM
   ═══════════════════════════════════════════════════════ */

function xpForLevel(level) {
  return level * 150;
}

function addXP(economy, userId, amount) {
  const { userData } = getUser(economy, userId);

  // Honour an active xp_boost (set by `use xp_boost` in commands/economy/use.js).
  // The boost is a single field on `userData.boosts.xpBoost` containing the
  // expiry timestamp; if it's in the future we apply +50% to incoming XP.
  // When the timer has elapsed we lazily clear the flag so it doesn't
  // accumulate stale data on the user record.
  let bonusFromBoost = 0;
  const boostExpiry = Number(userData.boosts?.xpBoost || 0);
  if (boostExpiry > Date.now()) {
    bonusFromBoost = Math.floor((amount || 0) * 0.5);
  } else if (boostExpiry > 0) {
    delete userData.boosts.xpBoost;
  }

  const finalAmount = (amount || 0) + bonusFromBoost;
  userData.xp = (userData.xp || 0) + finalAmount;
  userData.level = userData.level || 1;

  let leveledUp = false;
  let newLevel = userData.level;

  let needed = xpForLevel(userData.level);
  while (userData.xp >= needed) {
    userData.xp -= needed;
    userData.level += 1;
    leveledUp = true;
    newLevel = userData.level;
    needed = xpForLevel(userData.level);
  }

  return { leveledUp, newLevel, boosted: bonusFromBoost > 0, bonusFromBoost };
}

/* ═══════════════════════════════════════════════════════
   ACHIEVEMENT SYSTEM
   ═══════════════════════════════════════════════════════ */

function checkAchievement(economy, userId, achievementId) {
  const { userData } = getUser(economy, userId);
  if (!Array.isArray(userData.achievements)) {
    userData.achievements = [];
  }
  if (!userData.achievements.includes(achievementId) && ACHIEVEMENTS[achievementId]) {
    userData.achievements.push(achievementId);
    return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════
   LOAN SYSTEM
   ═══════════════════════════════════════════════════════ */

function addLoan(economy, userId, amount, interest) {
  const { userData } = getUser(economy, userId);
  if (!Array.isArray(userData.loans)) userData.loans = [];
  // Per-loan interest is stamped at borrow-time so a Trusted-tier
  // loan keeps its 8% rate even if the borrower regresses later.
  // Falls back to the legacy 10% default for callers that don't
  // supply a rate.
  const loan = {
    amount,
    takenAt: Date.now(),
    interest: typeof interest === 'number' && interest > 0 ? interest : 0.10,
  };
  userData.loans.push(loan);
  userData.coins += amount;
  return loan;
}

function repayLoan(economy, userId, amount) {
  const { userData } = getUser(economy, userId);
  if (!Array.isArray(userData.loans) || userData.loans.length === 0) {
    return { error: 'No active loans.' };
  }
  if (userData.coins < amount) {
    return { error: 'Insufficient coins.' };
  }

  // Apply payment across loans, oldest-first. The previous version
  // operated on `loans[0]` only, so a user with 2 or 3 active loans
  // could never repay the later ones — the prefix UI couldn't even
  // target them. It also reset `takenAt = Date.now()` on every
  // partial repayment, letting a user dodge daily compounding by
  // paying 1 coin a day forever. Both bugs are fixed here.
  let remaining = amount;
  let totalPaid = 0;
  let totalOwedAcrossLoans = 0;
  let clearedAll = true;
  // Track repayment reputation: each loan that gets fully cleared
  // bumps `loanRepCount`. If it took >5 days to clear we also bump
  // `loanLatePays`, which the loan-tier helper uses to compute the
  // borrowing limit.
  let clearedThisCall = 0;
  let lateThisCall = 0;
  let principalClearedThisCall = 0;

  for (const loan of userData.loans) {
    const days = Math.max(0, Math.floor((Date.now() - loan.takenAt) / 86400000));
    const owed = Math.floor(loan.amount * Math.pow(1 + loan.interest, days));
    totalOwedAcrossLoans += owed;
    if (remaining <= 0) {
      clearedAll = false;
      continue;
    }
    const pay = Math.min(remaining, owed);
    totalPaid += pay;
    remaining -= pay;
    if (pay >= owed) {
      principalClearedThisCall += loan.amount;
      if (days > 5) lateThisCall++;
      clearedThisCall++;
      loan.amount = 0;
      loan.cleared = true;
    } else {
      // Partial repayment: store the *post-interest* remaining
      // principal but keep the original `takenAt` so the next day's
      // interest still applies — preventing the "1 coin a day"
      // cheese.
      loan.amount = owed - pay;
      clearedAll = false;
    }
  }

  userData.coins -= totalPaid;
  // Drop fully-cleared loans from the array so a user with the slot
  // limit (3) can borrow again after settling.
  userData.loans = userData.loans.filter(l => !l.cleared && (l.amount || 0) > 0);

  // Persist reputation counters for the loan tier system.
  if (clearedThisCall > 0) {
    userData.loanRepCount  = (userData.loanRepCount  || 0) + clearedThisCall;
    userData.loanLatePays  = (userData.loanLatePays  || 0) + lateThisCall;
    userData.loanRepAmount = (userData.loanRepAmount || 0) + principalClearedThisCall;
    userData.lastLoanRepay = Date.now();
  }

  return {
    paid: totalPaid,
    totalOwed: totalOwedAcrossLoans,
    cleared: clearedAll,
    clearedCount: clearedThisCall,
    latePays: lateThisCall,
  };
}

/* ═══════════════════════════════════════════════════════
   BULK ACHIEVEMENT CHECK
   Checks all milestone-based achievements for a user.
   Call after mutating userData before saving economy.
   ═══════════════════════════════════════════════════════ */

function checkAllAchievements(economy, userId) {
  const { userData } = getUser(economy, userId);

  const checks = [
    ['first_mine',     (userData.miningCount || 0) >= 1],
    ['master_miner',   (userData.miningCount || 0) >= 100],
    ['first_heist',    (userData.heistCount  || 0) >= 1],
    ['master_crafter', (userData.craftCount  || 0) >= 25],
    ['first_farm',     (userData.harvestCount || 0) >= 1],
    ['generous',       (userData.giftsSent   || 0) >= 10],
    ['stock_trader',   Object.keys(userData.stockPortfolio || {}).length >= 1],
    ['gambler',        (userData.totalGambled|| 0) >= 1_000_000],
    ['criminal',       (userData.crimeCount  || 0) >= 50],
    ['fisher',         (userData.fishCaught  || 0) >= 50],
    ['first_battle',   (userData.battlesWon  || 0) >= 1],
    ['battle_50',      (userData.battlesWon  || 0) >= 50],
    ['adventurer',     (userData.adventuresCompleted || 0) >= 25],
  ];

  for (const [id, condition] of checks) {
    if (condition) checkAchievement(economy, userId, id);
  }
}

/* ═══════════════════════════════════════════════════════
   NET WORTH HELPER
   ═══════════════════════════════════════════════════════ */

function getNetWorth(userData, stockPrices) {
  const wallet = Number(userData.coins) || 0;
  const bank = Number(userData.bank) || 0;

  let stockValue = 0;
  if (stockPrices && userData.stockPortfolio) {
    for (const [symbol, shares] of Object.entries(userData.stockPortfolio)) {
      const price = stockPrices[symbol] || 0;
      stockValue += price * (shares || 0);
    }
  }

  const loanDebt = Array.isArray(userData.loans)
    ? userData.loans.reduce((sum, l) => sum + (l.amount || 0), 0)
    : 0;

  return wallet + bank + stockValue - loanDebt;
}

/* ═══════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════ */

module.exports = {
  DEFAULT_USER_DATA,
  ACHIEVEMENTS,
  loadEconomy,
  saveEconomy,
  getUser,
  formatNumber,
  formatTime,
  addXP,
  checkAchievement,
  checkAllAchievements,
  addLoan,
  repayLoan,
  getNetWorth,
};
