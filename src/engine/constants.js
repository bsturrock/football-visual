// World units are YARDS. +X runs toward the right end zone (as seen from the
// broadcast camera), Z runs across the field (+Z = near/camera sideline), Y is up.
export const FIELD = {
  HALF_LEN: 60,      // end line
  GOAL: 50,          // goal line
  HALF_WID: 26.667,  // sideline
  HASH: 6.667,       // college-style hash rows (matches reference image spacing)
};

export const GRAVITY = 10.72;      // 32.2 ft/s^2 in yd/s^2
export const PHYS_DT = 1 / 120;    // fixed physics step

// Athletic profiles per position. Every value can be overridden per player
// through `ratings` when spawning (your sim's player ratings). Mass comes from
// the player's weight (Body.js) unless `ratings.mass` is given.
export const PROFILES = {
  QB: { speed: 8.0, strength: 0.6,  agility: 0.8,  hands: 0.75, tackle: 0.3,  balance: 0.85, block: 0.3,  passRush: 0.2, accuracy: 0.86, arm: 0.85, security: 0.8 },
  RB: { speed: 9.3, strength: 0.75, agility: 0.95, hands: 0.75, tackle: 0.4,  balance: 1.1,  block: 0.55, passRush: 0.3, security: 0.88 },
  WR: { speed: 9.7, strength: 0.55, agility: 1.0,  hands: 0.86, tackle: 0.3,  balance: 0.85, block: 0.4,  passRush: 0.2, security: 0.8 },
  TE: { speed: 8.5, strength: 0.9,  agility: 0.75, hands: 0.78, tackle: 0.5,  balance: 1.0,  block: 0.8,  passRush: 0.4, security: 0.85 },
  OL: { speed: 6.9, strength: 1.15, agility: 0.55, hands: 0.3,  tackle: 0.5,  balance: 1.1,  block: 1.0,  passRush: 0.3, security: 0.6 },
  DL: { speed: 7.6, strength: 1.12, agility: 0.65, hands: 0.3,  tackle: 0.95, balance: 1.05, block: 0.6,  passRush: 0.9, security: 0.6 },
  LB: { speed: 8.7, strength: 0.95, agility: 0.85, hands: 0.5,  tackle: 1.05, balance: 1.0,  block: 0.6,  passRush: 0.7, security: 0.7 },
  CB: { speed: 9.7, strength: 0.55, agility: 1.0,  hands: 0.62, tackle: 0.8,  balance: 0.85, block: 0.3,  passRush: 0.4, security: 0.7 },
  S:  { speed: 9.3, strength: 0.7,  agility: 0.9,  hands: 0.6,  tackle: 0.95, balance: 0.95, block: 0.4,  passRush: 0.5, security: 0.7 },
  K:  { speed: 7.8, strength: 0.4,  agility: 0.7,  hands: 0.5,  tackle: 0.2,  balance: 0.7,  block: 0.2,  passRush: 0.1, security: 0.6 },
};

export const SKIN_TONES = ['#f0c3a0', '#d9a07a', '#c68b62', '#a8693f', '#8a5230', '#6b3e22', '#5a321b'];
