export enum GameState {
  START,
  PLAYING,
  GAME_OVER,
  LEADERBOARD_INPUT,
  SHOP
}

export interface Point {
  x: number;
  y: number;
}

export interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
  markedForDeletion: boolean;
}

export enum WeaponType {
  SINGLE,
  SPREAD
}

export interface Player extends Entity {
  vx: number;
  vy: number;
  speedY: number; 
  fuel: number;
  lives: number;
  score: number;
  gold: number;
  isInvulnerable: boolean;
  invulnerableTimer: number;
  weaponType: WeaponType;
}

export enum EnemyType {
  SHIP,
  HELICOPTER,
  JET,
  FUEL_DEPOT,
  BRIDGE,
  LIFE_ORB,
  WEAPON_CRATE,
  GOLD_COIN,
  BOSS // New Enemy Type
}

export interface Enemy extends Entity {
  type: EnemyType;
  vx: number;
  vy: number;
  shootTimer: number; 
  hp: number; // Hit Points
  maxHp: number; // Max Hit Points for health bar
}

export interface Bullet extends Entity {
  vx: number;
  vy: number;
  isEnemy: boolean; 
}

export interface Particle extends Entity {
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export interface Explosion {
  x: number;
  y: number;
  particles: Particle[];
}

export interface LeaderboardEntry {
  name: string;
  score: number;
}

// Yeni: Çevre dekorasyonları için tipler
export enum DecorationType {
  TREE,
  HOUSE
}

export interface Decoration {
  x: number;
  y: number;
  type: DecorationType;
  variant: number; // Added variant for visual diversity
  markedForDeletion: boolean;
}