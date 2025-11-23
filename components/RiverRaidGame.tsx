import React, { useEffect, useRef, useState } from 'react';
import { GameState, Player, Enemy, EnemyType, Bullet, Particle, LeaderboardEntry, WeaponType, Decoration, DecorationType } from '../types';

// --- Constants ---
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 800;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 32;
const BASE_SCROLL_SPEED = 3; 
const MAX_FUEL = 100;
const FUEL_CONSUMPTION_RATE = 0.05;
const FUEL_REFILL_RATE = 0.8;
const RIVER_SEGMENT_HEIGHT = 20;
const MAX_LEADERBOARD_ENTRIES = 5;
const SHOOTING_START_FRAME = 3600; // 60 seconds * 60 FPS

export const RiverRaidGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  // Re-render tetiklemek için UI state
  const [uiGameState, setUiGameState] = useState<GameState>(GameState.START);
  
  const state = useRef({
    gameState: GameState.START,
    keys: {} as { [key: string]: boolean },
    player: {
      x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
      y: CANVAS_HEIGHT - 120,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      vx: 0,
      vy: 0,
      speedY: 0,
      fuel: MAX_FUEL,
      lives: 3,
      score: 0,
      gold: 0,
      isInvulnerable: false,
      invulnerableTimer: 0,
      markedForDeletion: false,
      weaponType: WeaponType.SINGLE,
    } as Player,
    bullets: [] as Bullet[],
    enemies: [] as Enemy[],
    particles: [] as Particle[],
    riverSegments: [] as { y: number, centerX: number, width: number }[],
    decorations: [] as Decoration[],
    distanceCounter: 0, 
    enemySpawnTimer: 0,
    gameFrameCount: 0, 
    difficulty: 1.0,
    highScores: [] as LeaderboardEntry[],
    playerNameInput: "",
  });

  // --- Helpers ---
  const loadHighScores = () => {
    const stored = localStorage.getItem('riverRaidScores');
    if (stored) {
      state.current.highScores = JSON.parse(stored);
    } else {
      state.current.highScores = [
        { name: "ACE", score: 5000 },
        { name: "PIL", score: 3000 },
        { name: "CPU", score: 1000 },
      ];
    }
  };

  const saveHighScores = () => {
    localStorage.setItem('riverRaidScores', JSON.stringify(state.current.highScores));
  };

  const loadGold = (): number => {
      const stored = localStorage.getItem('riverRaidGold');
      return stored ? parseInt(stored, 10) : 0;
  };

  const saveGold = (amount: number) => {
      localStorage.setItem('riverRaidGold', amount.toString());
  };

  // --- Mobile Input Helpers ---
  const handleTouchStart = (key: string) => {
    state.current.keys[key] = true;
    
    // Özel durumlar (Market, Restart vb. için anlık tetiklemeler)
    if (key === 'KeyM') {
        if (state.current.gameState === GameState.PLAYING) {
            state.current.gameState = GameState.SHOP;
            setUiGameState(GameState.SHOP);
        } else if (state.current.gameState === GameState.SHOP) {
            state.current.gameState = GameState.PLAYING;
            setUiGameState(GameState.PLAYING);
        }
    }
    
    // Start Game logic for touch
    if (state.current.gameState === GameState.START && key === 'Space') {
        initGame(true);
    }
    
    // Restart logic for touch
    if (state.current.gameState === GameState.GAME_OVER && key === 'KeyR') {
        initGame(true);
    }

    // Fire logic for touch (Space)
    if (state.current.gameState === GameState.PLAYING && key === 'Space') {
        const s = state.current;
        if (s.player.weaponType === WeaponType.SPREAD) {
            s.bullets.push(
                { x: s.player.x + s.player.width / 2 - 2, y: s.player.y, width: 4, height: 10, vx: 0, vy: 10, isEnemy: false, markedForDeletion: false },
                { x: s.player.x, y: s.player.y + 5, width: 4, height: 10, vx: -3, vy: 9, isEnemy: false, markedForDeletion: false },
                { x: s.player.x + s.player.width, y: s.player.y + 5, width: 4, height: 10, vx: 3, vy: 9, isEnemy: false, markedForDeletion: false }
            );
        } else {
            s.bullets.push({
                x: s.player.x + s.player.width / 2 - 2,
                y: s.player.y,
                width: 4,
                height: 10,
                vx: 0,
                vy: 10,
                isEnemy: false,
                markedForDeletion: false
            });
        }
    }
  };

  const handleTouchEnd = (key: string) => {
    state.current.keys[key] = false;
  };

  // --- Game Engine Methods ---

  const initGame = (fullReset: boolean = false) => {
    const s = state.current;
    loadHighScores();
    s.player.gold = loadGold(); 
    
    if (fullReset) {
      s.player.lives = 3;
      s.player.score = 0;
      s.distanceCounter = 0;
      s.gameFrameCount = 0;
      s.difficulty = 1.0;
      s.playerNameInput = "";
    }

    s.player.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
    s.player.y = CANVAS_HEIGHT - 120;
    s.player.fuel = MAX_FUEL;
    s.player.vx = 0;
    s.player.vy = 0;
    s.player.isInvulnerable = true;
    s.player.invulnerableTimer = 120; 
    s.player.weaponType = WeaponType.SINGLE; 
    
    s.bullets = [];
    s.enemies = [];
    s.particles = [];
    s.decorations = [];
    s.keys = {};
    s.enemySpawnTimer = 0;

    s.riverSegments = [];
    for (let y = CANVAS_HEIGHT; y > -RIVER_SEGMENT_HEIGHT * 5; y -= RIVER_SEGMENT_HEIGHT) {
      addRiverSegment(y);
    }
    
    s.gameState = GameState.PLAYING;
    setUiGameState(GameState.PLAYING);
  };

  const addRiverSegment = (yPos: number) => {
    const s = state.current;
    s.distanceCounter++; 

    const t = s.distanceCounter * 0.05; 
    const difficultyNarrowing = Math.min(40, (s.difficulty - 1) * 10);
    
    const center = (CANVAS_WIDTH / 2) + Math.sin(t) * 100 + Math.sin(t * 0.5) * 40;
    let width = 340 + Math.cos(t * 1.3) * 80 - difficultyNarrowing;
    width = Math.max(220, Math.min(width, CANVAS_WIDTH - 40));
    
    const segmentX = Math.max(width / 2 + 20, Math.min(center, CANVAS_WIDTH - width / 2 - 20));

    s.riverSegments.unshift({ 
      y: yPos, 
      centerX: segmentX,
      width: width
    });

    // Decorations
    const leftBankEnd = segmentX - width / 2;
    if (leftBankEnd > 40 && Math.random() < 0.3) {
        const type = Math.random() > 0.9 ? DecorationType.HOUSE : DecorationType.TREE;
        s.decorations.push({
            x: Math.random() * (leftBankEnd - 30),
            y: yPos,
            type: type,
            markedForDeletion: false
        });
    }

    const rightBankStart = segmentX + width / 2;
    if (CANVAS_WIDTH - rightBankStart > 40 && Math.random() < 0.3) {
        const type = Math.random() > 0.9 ? DecorationType.HOUSE : DecorationType.TREE;
        s.decorations.push({
            x: rightBankStart + Math.random() * (CANVAS_WIDTH - rightBankStart - 30),
            y: yPos,
            type: type,
            markedForDeletion: false
        });
    }
  };

  const spawnEnemy = (riverSegment: { y: number, centerX: number, width: number }) => {
      const s = state.current;
      const typeRoll = Math.random();
      let type = EnemyType.SHIP;
      let width = 30;
      let height = 15;
      let speedX = 0;
      let speedY = 0; 

      // Increased Life Orb spawn chance from 0.01 to 0.05
      if (typeRoll < 0.05) {
          type = EnemyType.LIFE_ORB; width = 20; height = 20; speedY = 0;
      }
      else if (typeRoll < 0.08) {
          type = EnemyType.WEAPON_CRATE; width = 25; height = 25; speedY = 0;
      }
      else if (typeRoll < 0.23) {
          type = EnemyType.GOLD_COIN; width = 20; height = 20; speedY = 0;
      }
      else if (typeRoll < 0.38) {
        type = EnemyType.FUEL_DEPOT; width = 25; height = 40; speedY = 0; 
      } 
      else if (typeRoll < 0.68) {
        type = EnemyType.HELICOPTER; width = 30; height = 30;
        speedX = (Math.random() - 0.5) * (3 * s.difficulty); 
        speedY = 1; 
      } 
      else {
        if (Math.random() > 0.7) {
             type = EnemyType.JET; width = 25; height = 25;
             speedX = 0; speedY = 5 * s.difficulty;
        } else {
             type = EnemyType.SHIP; width = 40; height = 20;
             speedX = (Math.random() - 0.5) * (0.8 * s.difficulty); 
             speedY = 0.5;
        }
      }

      const minX = riverSegment.centerX - riverSegment.width / 2 + 20;
      const maxX = riverSegment.centerX + riverSegment.width / 2 - 20 - width;
      
      if (maxX <= minX) return;

      const x = minX + Math.random() * (maxX - minX);

      s.enemies.push({
        type,
        x,
        y: riverSegment.y,
        width,
        height,
        vx: speedX,
        vy: speedY, 
        shootTimer: Math.floor(Math.random() * 60 + 60), 
        markedForDeletion: false
      });
  };

  // --- Market Logic ---
  const buyItem = (itemIndex: number) => {
      const s = state.current;
      let cost = 0;
      let success = false;

      // Prices reduced by 50%
      switch(itemIndex) {
          case 1: // Refill Fuel
              cost = 5;
              if (s.player.gold >= cost) {
                  s.player.fuel = MAX_FUEL;
                  success = true;
              }
              break;
          case 2: // Shield (10s)
              cost = 10;
              if (s.player.gold >= cost) {
                  s.player.isInvulnerable = true;
                  s.player.invulnerableTimer = 600;
                  success = true;
              }
              break;
          case 3: // Spread Gun
              cost = 15;
              if (s.player.gold >= cost) {
                  s.player.weaponType = WeaponType.SPREAD;
                  success = true;
              }
              break;
          case 4: // Nuke
              cost = 25;
              if (s.player.gold >= cost) {
                  s.enemies.forEach(e => {
                      if (e.type !== EnemyType.GOLD_COIN && e.type !== EnemyType.FUEL_DEPOT && e.type !== EnemyType.LIFE_ORB && e.type !== EnemyType.WEAPON_CRATE) {
                          if (e.y > 0 && e.y < CANVAS_HEIGHT) {
                              e.markedForDeletion = true;
                              createExplosion(e.x + e.width/2, e.y + e.height/2, 'orange', 15);
                              s.player.score += 50;
                          }
                      }
                  });
                  s.bullets.forEach(b => b.markedForDeletion = true);
                  createExplosion(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, 'white', 100);
                  success = true;
              }
              break;
      }

      if (success) {
          s.player.gold -= cost;
          saveGold(s.player.gold);
      }
  };

  // --- Update Loop ---

  const update = () => {
    const s = state.current;
    if (s.gameState !== GameState.PLAYING) return;

    s.gameFrameCount++;

    // Time Bonus
    if (s.gameFrameCount % 900 === 0 && s.gameFrameCount > 0) {
        const difficultyStep = Math.floor(s.gameFrameCount / 900);
        s.difficulty = 1.0 + (difficultyStep * 0.1); 
        
        s.player.score += 500;
        createExplosion(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, '#fbbf24', 40);
    }

    const currentScrollSpeed = BASE_SCROLL_SPEED * Math.min(2.0, s.difficulty);

    // 1. Player Controls
    // Reduced speed from 5 to 3.5
    const playerSpeed = 3.5 * Math.min(1.5, s.difficulty);
    if (s.keys['ArrowLeft']) s.player.vx = -playerSpeed;
    else if (s.keys['ArrowRight']) s.player.vx = playerSpeed;
    else s.player.vx = 0;

    if (s.keys['ArrowUp']) s.player.vy = -playerSpeed; 
    else if (s.keys['ArrowDown']) s.player.vy = playerSpeed; 
    else s.player.vy = 0;

    s.player.x += s.player.vx;
    s.player.y += s.player.vy;

    if (s.player.y < 0) s.player.y = 0;
    if (s.player.y > CANVAS_HEIGHT - s.player.height) s.player.y = CANVAS_HEIGHT - s.player.height;

    s.player.fuel -= FUEL_CONSUMPTION_RATE;
    if (s.player.fuel <= 0) {
      handleDeath("OUT OF FUEL");
      return;
    }

    if (s.player.isInvulnerable) {
      s.player.invulnerableTimer--;
      if (s.player.invulnerableTimer <= 0) s.player.isInvulnerable = false;
    }

    // 2. Map Scrolling & Decorations
    for (let i = 0; i < s.riverSegments.length; i++) {
      s.riverSegments[i].y += currentScrollSpeed;
    }
    if (s.riverSegments.length > 0 && s.riverSegments[s.riverSegments.length - 1].y > CANVAS_HEIGHT) {
      s.riverSegments.pop();
    }

    for (let i = 0; i < s.decorations.length; i++) {
        s.decorations[i].y += currentScrollSpeed;
        if (s.decorations[i].y > CANVAS_HEIGHT) {
            s.decorations[i].markedForDeletion = true;
        }
    }
    s.decorations = s.decorations.filter(d => !d.markedForDeletion);


    const topSegment = s.riverSegments[0];
    if (topSegment && topSegment.y > -RIVER_SEGMENT_HEIGHT) {
      addRiverSegment(topSegment.y - RIVER_SEGMENT_HEIGHT);
      
      s.enemySpawnTimer++;
      const spawnThreshold = Math.max(2, 5 - (s.difficulty * 0.5));
      if (s.enemySpawnTimer > spawnThreshold) { 
        if (Math.random() < Math.min(0.8, 0.3 * s.difficulty)) {
            spawnEnemy(s.riverSegments[0]);
        }
        s.enemySpawnTimer = 0;
      }
    }

    // 3. Update Entities
    s.enemies.forEach(enemy => {
      enemy.y += currentScrollSpeed + (enemy.vy || 0);
      enemy.x += enemy.vx;

      if (enemy.type === EnemyType.HELICOPTER) {
         if (enemy.x <= 50 || enemy.x + enemy.width >= CANVAS_WIDTH - 50) enemy.vx *= -1;
      }

      // Shooting Logic: 1 minute delay
      if (s.gameFrameCount > SHOOTING_START_FRAME) {
          if (enemy.y > 0 && enemy.y < CANVAS_HEIGHT - 100) { 
             if (enemy.type === EnemyType.SHIP || enemy.type === EnemyType.HELICOPTER || enemy.type === EnemyType.JET) {
                 enemy.shootTimer--;
                 if (enemy.shootTimer <= 0) {
                     const bulletSpeed = 4 + s.difficulty;
                     s.bullets.push({
                         x: enemy.x + enemy.width / 2 - 3,
                         y: enemy.y + enemy.height,
                         width: 6,
                         height: 6,
                         vx: 0,
                         vy: -bulletSpeed, 
                         isEnemy: true,
                         markedForDeletion: false
                     });
                     enemy.shootTimer = Math.max(30, 120 - (s.difficulty * 20));
                 }
             }
          }
      }
      
      if (enemy.y > CANVAS_HEIGHT) enemy.markedForDeletion = true;
    });
    s.enemies = s.enemies.filter(e => !e.markedForDeletion);

    // Bullets Movement
    s.bullets.forEach(bullet => {
      bullet.y -= bullet.vy; 
      bullet.x += bullet.vx || 0; 
      
      if (bullet.isEnemy) {
          if (bullet.y > CANVAS_HEIGHT) bullet.markedForDeletion = true;
      } else {
          if (bullet.y < 0 || bullet.x < 0 || bullet.x > CANVAS_WIDTH) bullet.markedForDeletion = true;
      }
    });

    // Bullet Neutralization
    for (let i = 0; i < s.bullets.length; i++) {
        const b1 = s.bullets[i];
        if (b1.markedForDeletion) continue;

        for (let j = i + 1; j < s.bullets.length; j++) {
            const b2 = s.bullets[j];
            if (b2.markedForDeletion) continue;

            if (b1.isEnemy !== b2.isEnemy) {
                if (checkCollision(b1, b2)) {
                    b1.markedForDeletion = true;
                    b2.markedForDeletion = true;
                    createExplosion((b1.x + b2.x) / 2, (b1.y + b2.y) / 2, '#9ca3af', 6);
                }
            }
        }
    }

    s.bullets = s.bullets.filter(b => !b.markedForDeletion);

    // Particles
    s.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy + currentScrollSpeed;
      p.life--;
      if (p.life <= 0) p.markedForDeletion = true;
    });
    s.particles = s.particles.filter(p => !p.markedForDeletion);


    // 4. Collision Detection

    // River Banks
    const playerSegment = s.riverSegments.find(seg => 
      s.player.y + s.player.height/2 >= seg.y && s.player.y + s.player.height/2 < seg.y + RIVER_SEGMENT_HEIGHT
    );

    if (playerSegment && !s.player.isInvulnerable) {
      const bankLeft = playerSegment.centerX - playerSegment.width / 2;
      const bankRight = playerSegment.centerX + playerSegment.width / 2;

      if (s.player.x < bankLeft || s.player.x + s.player.width > bankRight) {
        handleDeath("CRASHED INTO LAND");
        return;
      }
    }

    s.enemies.forEach(enemy => {
      if (checkCollision(s.player, enemy)) {
        if (enemy.type === EnemyType.FUEL_DEPOT) {
           s.player.fuel = Math.min(s.player.fuel + FUEL_REFILL_RATE * 30, MAX_FUEL);
           enemy.markedForDeletion = true;
        } else if (enemy.type === EnemyType.GOLD_COIN) {
           s.player.gold++;
           s.player.score += 50;
           saveGold(s.player.gold);
           enemy.markedForDeletion = true;
        } else if (enemy.type === EnemyType.LIFE_ORB) {
           s.player.lives++;
           s.player.score += 100;
           createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2, '#ec4899', 20);
           enemy.markedForDeletion = true;
        } else if (enemy.type === EnemyType.WEAPON_CRATE) {
           s.player.weaponType = WeaponType.SPREAD;
           s.player.score += 100;
           createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2, '#06b6d4', 20);
           enemy.markedForDeletion = true;
        } else if (enemy.type !== EnemyType.BRIDGE) {
           createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2);
           enemy.markedForDeletion = true;
           if (!s.player.isInvulnerable) handleDeath("CRASHED INTO ENEMY");
        }
      }
    });

    s.bullets.forEach(bullet => {
      if (bullet.markedForDeletion) return;

      if (bullet.isEnemy) {
          if (!s.player.isInvulnerable && checkCollision(bullet, s.player)) {
             bullet.markedForDeletion = true;
             handleDeath("SHOT BY ENEMY");
          }
      } else {
          s.enemies.forEach(enemy => {
            if (!bullet.markedForDeletion && !enemy.markedForDeletion && checkCollision(bullet, enemy)) {
              if (enemy.type === EnemyType.FUEL_DEPOT) {
                 bullet.markedForDeletion = true;
                 enemy.markedForDeletion = true;
                 createExplosion(enemy.x, enemy.y, 'orange');
                 s.player.score += 150; 
              } else if (enemy.type === EnemyType.LIFE_ORB || enemy.type === EnemyType.WEAPON_CRATE || enemy.type === EnemyType.GOLD_COIN) {
                 bullet.markedForDeletion = true;
                 enemy.markedForDeletion = true;
                 createExplosion(enemy.x, enemy.y, 'white');
                 s.player.score += 10; 
              } else {
                 bullet.markedForDeletion = true;
                 enemy.markedForDeletion = true;
                 createExplosion(enemy.x, enemy.y);
                 s.player.score += 100;
              }
            }
          });
      }
    });
  };

  const handleDeath = (reason: string) => {
    const s = state.current;
    createExplosion(s.player.x, s.player.y, 'red', 50);
    s.player.lives--;
    if (s.player.lives > 0) {
      s.player.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
      s.player.y = CANVAS_HEIGHT - 120;
      s.player.vx = 0;
      s.player.vy = 0;
      s.player.isInvulnerable = true;
      s.player.invulnerableTimer = 120;
      s.player.fuel = MAX_FUEL;
      s.player.weaponType = WeaponType.SINGLE;
      s.enemies = s.enemies.filter(e => e.y < CANVAS_HEIGHT - 300);
      s.bullets = []; 
    } else {
      checkHighScore();
    }
  };

  const checkHighScore = () => {
    const s = state.current;
    const lowestHigh = s.highScores.length < MAX_LEADERBOARD_ENTRIES ? 0 : s.highScores[s.highScores.length - 1].score;
    if (s.player.score > lowestHigh || s.highScores.length < MAX_LEADERBOARD_ENTRIES) {
        s.gameState = GameState.LEADERBOARD_INPUT;
        setUiGameState(GameState.LEADERBOARD_INPUT);
        s.playerNameInput = "";
    } else {
        s.gameState = GameState.GAME_OVER;
        setUiGameState(GameState.GAME_OVER);
    }
  };

  const submitHighScore = () => {
      const s = state.current;
      const name = s.playerNameInput || "UNK";
      s.highScores.push({ name: name.toUpperCase(), score: s.player.score });
      s.highScores.sort((a, b) => b.score - a.score);
      if (s.highScores.length > MAX_LEADERBOARD_ENTRIES) {
          s.highScores.pop();
      }
      saveHighScores();
      s.gameState = GameState.GAME_OVER;
      setUiGameState(GameState.GAME_OVER);
  };

  const createExplosion = (x: number, y: number, color: string = 'white', count: number = 10) => {
     for(let i=0; i<count; i++) {
       state.current.particles.push({
         x, 
         y,
         vx: (Math.random() - 0.5) * 10,
         vy: (Math.random() - 0.5) * 10,
         life: 20 + Math.random() * 20,
         color: color,
         size: Math.random() * 4 + 2,
         width: 0, height: 0, markedForDeletion: false
       });
     }
  };

  const checkCollision = (r1: {x:number, y:number, width:number, height:number}, r2: {x:number, y:number, width:number, height:number}) => {
    return (
      r1.x < r2.x + r2.width &&
      r1.x + r1.width > r2.x &&
      r1.y < r2.y + r2.height &&
      r1.y + r1.height > r2.y
    );
  };

  // --- Rendering ---

  const draw = (ctx: CanvasRenderingContext2D) => {
    const s = state.current;

    // Background
    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // River
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    if (s.riverSegments.length > 0) {
      const sortedSegments = [...s.riverSegments].sort((a, b) => a.y - b.y);
      if (sortedSegments.length > 0) {
          const top = sortedSegments[0];
          ctx.moveTo(top.centerX - top.width/2, top.y);
          for (let seg of sortedSegments) ctx.lineTo(seg.centerX - seg.width/2, seg.y);
          const last = sortedSegments[sortedSegments.length-1];
          ctx.lineTo(last.centerX - last.width/2, last.y + RIVER_SEGMENT_HEIGHT);
          ctx.lineTo(last.centerX + last.width/2, last.y + RIVER_SEGMENT_HEIGHT);
          for (let i = sortedSegments.length - 1; i >= 0; i--) {
              const seg = sortedSegments[i];
              ctx.lineTo(seg.centerX + seg.width/2, seg.y);
          }
          ctx.lineTo(top.centerX + top.width/2, top.y);
      }
    }
    ctx.closePath();
    ctx.fill();

    // Decorations
    s.decorations.forEach(d => {
        if (d.type === DecorationType.TREE) {
            ctx.fillStyle = '#064e3b'; // Dark Green
            ctx.beginPath();
            ctx.moveTo(d.x + 10, d.y);
            ctx.lineTo(d.x + 20, d.y + 25);
            ctx.lineTo(d.x, d.y + 25);
            ctx.fill();
        } else if (d.type === DecorationType.HOUSE) {
            ctx.fillStyle = '#f8fafc'; // White Walls
            ctx.fillRect(d.x, d.y + 10, 20, 15);
            ctx.fillStyle = '#b91c1c'; // Red Roof
            ctx.beginPath();
            ctx.moveTo(d.x + 10, d.y);
            ctx.lineTo(d.x + 24, d.y + 10);
            ctx.lineTo(d.x - 4, d.y + 10);
            ctx.fill();
            // Door
            ctx.fillStyle = '#475569';
            ctx.fillRect(d.x + 8, d.y + 18, 4, 7);
        }
    });

    // Entities
    s.enemies.forEach(e => {
      if (e.type === EnemyType.SHIP) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(e.x + 5, e.y - 5, 10, 5);
      } else if (e.type === EnemyType.HELICOPTER) {
        ctx.fillStyle = '#be123c';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#000';
        ctx.fillRect(e.x - 5, e.y, e.width + 10, 2);
        if (Math.floor(Date.now()/50)%2===0) {
            ctx.fillRect(e.x - 10, e.y - 5, e.width + 20, 2);
        } else {
            ctx.fillRect(e.x, e.y - 5, e.width, 2);
        }
      } else if (e.type === EnemyType.JET) {
        ctx.fillStyle = '#7c3aed';
        ctx.beginPath();
        ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.width, e.y); ctx.lineTo(e.x + e.width/2, e.y + e.height);
        ctx.fill();
      } else if (e.type === EnemyType.FUEL_DEPOT) {
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.fillText("FUEL", e.x, e.y + 12);
      } else if (e.type === EnemyType.WEAPON_CRATE) {
        ctx.fillStyle = '#06b6d4';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        ctx.fillText("W", e.x + 5, e.y + 18);
      } else if (e.type === EnemyType.LIFE_ORB) {
        ctx.fillStyle = '#ec4899';
        ctx.beginPath();
        ctx.arc(e.x + e.width/2, e.y + e.height/2, e.width/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.fillText("♥", e.x + 5, e.y + 15);
      } else if (e.type === EnemyType.GOLD_COIN) {
        ctx.fillStyle = '#facc15'; 
        ctx.beginPath();
        ctx.arc(e.x + e.width/2, e.y + e.height/2, e.width/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#b45309';
        ctx.font = '12px sans-serif';
        ctx.fillText("$", e.x + 6, e.y + 14);
      } else if (e.type === EnemyType.BRIDGE) {
        ctx.fillStyle = '#57534e';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.strokeStyle = '#292524';
        ctx.lineWidth = 2;
        ctx.strokeRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#facc15';
        for(let i=0; i<e.width; i+=40) ctx.fillRect(e.x + i, e.y + 13, 20, 4);
      }
    });

    // Player
    if (!s.player.isInvulnerable || Math.floor(Date.now() / 100) % 2 === 0) {
        // Change color every minute (approx 3600 frames at 60fps)
        const planeColors = [
            '#fbbf24', // Amber (Default)
            '#ffffff', // White (Visible on river)
            '#ef4444', // Red
            '#4ade80', // Bright Green
            '#a855f7', // Purple
            '#ec4899', // Pink
            '#22d3ee', // Cyan
            '#f97316', // Orange
        ];
        const colorIndex = Math.floor(s.gameFrameCount / 3600) % planeColors.length;
        ctx.fillStyle = planeColors[colorIndex];

        ctx.beginPath();
        ctx.moveTo(s.player.x + s.player.width/2, s.player.y);
        ctx.lineTo(s.player.x + s.player.width, s.player.y + s.player.height);
        ctx.lineTo(s.player.x + s.player.width/2, s.player.y + s.player.height - 10);
        ctx.lineTo(s.player.x, s.player.y + s.player.height);
        ctx.closePath();
        ctx.fill();
        
        if (s.keys['ArrowUp']) {
             ctx.fillStyle = `rgba(255, 150, 0, ${Math.random()})`;
             ctx.beginPath();
             ctx.moveTo(s.player.x + s.player.width/2 - 5, s.player.y + s.player.height - 5);
             ctx.lineTo(s.player.x + s.player.width/2 + 5, s.player.y + s.player.height - 5);
             ctx.lineTo(s.player.x + s.player.width/2, s.player.y + s.player.height + 25);
             ctx.fill();
        }
    }

    // Bullets
    s.bullets.forEach(b => {
      if (b.isEnemy) {
          ctx.fillStyle = '#f97316'; 
          ctx.fillRect(b.x, b.y, b.width, b.height);
      } else {
          ctx.fillStyle = '#fff';
          ctx.fillRect(b.x, b.y, b.width, b.height);
      }
    });

    // Particles
    s.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });

    // UI - Stats
    ctx.fillStyle = '#fff';
    ctx.font = '16px "Press Start 2P", cursive';
    ctx.fillText(`SCORE:${s.player.score}`, 10, 30);
    ctx.fillText(`LIVES:${s.player.lives}`, CANVAS_WIDTH - 140, 30);
    
    ctx.fillStyle = '#facc15';
    ctx.fillText(`GOLD:${s.player.gold}`, 10, 55);

    ctx.font = '10px "Press Start 2P"';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`LVL:${s.difficulty.toFixed(1)}`, 10, 75);

    // Fuel Bar
    const barWidth = 180;
    const barHeight = 15;
    const barX = CANVAS_WIDTH / 2 - barWidth / 2;
    const barY = CANVAS_HEIGHT - 25;
    
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    
    const fuelPct = Math.max(0, s.player.fuel / MAX_FUEL);
    ctx.fillStyle = fuelPct < 0.2 ? '#ef4444' : '#22c55e';
    ctx.fillRect(barX + 2, barY + 2, (barWidth - 4) * fuelPct, barHeight - 4);
    
    ctx.fillStyle = '#fff';
    ctx.font = '10px "Press Start 2P"';
    ctx.fillText("FUEL", barX + barWidth / 2 - 15, barY + 11);

    // --- Screens ---
    if (s.gameState === GameState.SHOP) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 4;
        ctx.strokeRect(50, 100, CANVAS_WIDTH - 100, CANVAS_HEIGHT - 200);
        ctx.fillStyle = '#facc15';
        ctx.font = '30px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText("MARKET", CANVAS_WIDTH/2, 160);
        ctx.font = '14px "Press Start 2P"';
        ctx.fillStyle = '#fff';
        ctx.fillText(`YOUR GOLD: ${s.player.gold}`, CANVAS_WIDTH/2, 200);
        const items = [
            { key: '1', name: 'FULL FUEL', cost: 5 },
            { key: '2', name: 'SHIELD (10s)', cost: 10 },
            { key: '3', name: 'SPREAD GUN', cost: 15 },
            { key: '4', name: 'NUKE BOMB', cost: 25 },
        ];
        let yPos = 280;
        items.forEach(item => {
            ctx.textAlign = 'left';
            ctx.fillStyle = s.player.gold >= item.cost ? '#4ade80' : '#9ca3af';
            ctx.fillText(`[${item.key}] ${item.name}`, 80, yPos);
            ctx.textAlign = 'right';
            ctx.fillText(`${item.cost} G`, CANVAS_WIDTH - 80, yPos);
            yPos += 60;
        });
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.font = '12px "Press Start 2P"';
        ctx.fillText("PRESS 'M' TO RESUME", CANVAS_WIDTH/2, CANVAS_HEIGHT - 140);
        ctx.textAlign = 'left';
    }
    else if (s.gameState === GameState.GAME_OVER || s.gameState === GameState.LEADERBOARD_INPUT) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.textAlign = 'center';
      if (s.gameState === GameState.LEADERBOARD_INPUT) {
          ctx.fillStyle = '#facc15';
          ctx.font = '30px "Press Start 2P"';
          ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH/2, 200);
          ctx.fillStyle = '#fff';
          ctx.font = '20px "Press Start 2P"';
          ctx.fillText(`SCORE: ${s.player.score}`, CANVAS_WIDTH/2, 250);
          
          // Updated text: NAME instead of INITIALS
          ctx.fillText("ENTER YOUR NAME:", CANVAS_WIDTH/2, 320);
          
          ctx.fillStyle = '#4ade80';
          // Reduced font size to fit longer names
          ctx.font = '30px "Press Start 2P"';
          ctx.fillText(s.playerNameInput + (Math.floor(Date.now()/500)%2===0 ? "_" : " "), CANVAS_WIDTH/2, 380);
          
          ctx.fillStyle = '#94a3b8';
          ctx.font = '12px "Press Start 2P"';
          ctx.fillText("TYPE NAME, ENTER TO SAVE", CANVAS_WIDTH/2, 450);
      } else {
          ctx.fillStyle = '#ef4444';
          ctx.font = '40px "Press Start 2P"';
          ctx.fillText("GAME OVER", CANVAS_WIDTH/2, 150);
          ctx.fillStyle = '#fff';
          ctx.font = '20px "Press Start 2P"';
          ctx.fillText(`FINAL SCORE: ${s.player.score}`, CANVAS_WIDTH/2, 200);
          ctx.fillStyle = '#facc15';
          ctx.fillText("TOP SCORES", CANVAS_WIDTH/2, 280);
          ctx.font = '16px "Press Start 2P"';
          ctx.fillStyle = '#fff';
          let yOff = 320;
          s.highScores.forEach((entry, idx) => {
              ctx.textAlign = 'left';
              ctx.fillText(`${idx+1}. ${entry.name}`, CANVAS_WIDTH/2 - 100, yOff);
              ctx.textAlign = 'right';
              ctx.fillText(`${entry.score}`, CANVAS_WIDTH/2 + 100, yOff);
              yOff += 30;
          });
          ctx.textAlign = 'center';
          ctx.fillStyle = '#fbbf24'; 
          ctx.font = '15px "Press Start 2P"';
          ctx.fillText("PRESS 'R' TO RESTART", CANVAS_WIDTH/2, CANVAS_HEIGHT - 100);
      }
      ctx.textAlign = 'left';
    } else if (s.gameState === GameState.START) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '20px "Press Start 2P"';
      ctx.textAlign = 'center';
      ctx.fillText("PRESS SPACE TO START", CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
      ctx.font = '12px "Press Start 2P"';
      ctx.fillStyle = '#fff';
      ctx.fillText("COLLECT GOLD [$], PRESS [M] FOR MARKET", CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 35);
      ctx.fillText("BUY SHIELDS, GUNS AND BOMBS!", CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 60);
      ctx.textAlign = 'left';
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const s = state.current;
      s.keys[e.code] = true;
      
      if (s.gameState === GameState.START && e.code === 'Space') {
        initGame(true);
      }
      else if (s.gameState === GameState.GAME_OVER && e.code === 'KeyR') {
        initGame(true);
      }
      else if (e.code === 'KeyM') {
          if (s.gameState === GameState.PLAYING) {
              s.gameState = GameState.SHOP;
              setUiGameState(GameState.SHOP);
          } else if (s.gameState === GameState.SHOP) {
              s.gameState = GameState.PLAYING;
              setUiGameState(GameState.PLAYING);
          }
      }
      else if (s.gameState === GameState.SHOP) {
          if (e.key === '1') buyItem(1);
          if (e.key === '2') buyItem(2);
          if (e.key === '3') buyItem(3);
          if (e.key === '4') buyItem(4);
      }
      else if (s.gameState === GameState.LEADERBOARD_INPUT) {
          // Allow letters, numbers, and spaces. Increased limit to 12 chars.
          if (e.key.length === 1 && e.key.match(/[a-zA-Z0-9 ]/)) {
              if (s.playerNameInput.length < 12) {
                  s.playerNameInput += e.key.toUpperCase();
              }
          } else if (e.code === 'Backspace') {
              s.playerNameInput = s.playerNameInput.slice(0, -1);
          } else if (e.code === 'Enter') {
              if (s.playerNameInput.length > 0) submitHighScore();
          }
      }
      else if (s.gameState === GameState.PLAYING && e.code === 'Space') {
        if (s.player.weaponType === WeaponType.SPREAD) {
            s.bullets.push(
                { x: s.player.x + s.player.width / 2 - 2, y: s.player.y, width: 4, height: 10, vx: 0, vy: 10, isEnemy: false, markedForDeletion: false },
                { x: s.player.x, y: s.player.y + 5, width: 4, height: 10, vx: -3, vy: 9, isEnemy: false, markedForDeletion: false },
                { x: s.player.x + s.player.width, y: s.player.y + 5, width: 4, height: 10, vx: 3, vy: 9, isEnemy: false, markedForDeletion: false }
            );
        } else {
            s.bullets.push({
                x: s.player.x + s.player.width / 2 - 2,
                y: s.player.y,
                width: 4,
                height: 10,
                vx: 0,
                vy: 10,
                isEnemy: false,
                markedForDeletion: false
            });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      state.current.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    initGame(); 
    state.current.gameState = GameState.START;
    setUiGameState(GameState.START);

    const loop = () => {
      update();
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
           ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
           draw(ctx);
        }
      }
      requestRef.current = requestAnimationFrame(loop);
    };
    
    requestRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center w-full">
        <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="block bg-black"
            style={{ width: '100%', maxHeight: '70vh', aspectRatio: '3/4' }}
        />
        
        {/* Mobile Controls */}
        <div className="w-full max-w-[600px] grid grid-cols-3 gap-4 p-4 mt-2 select-none touch-none bg-zinc-900 border-t border-zinc-700">
            {/* D-PAD Area */}
            <div className="flex flex-col items-center gap-1">
                <button 
                    className="w-12 h-12 bg-zinc-700 rounded active:bg-zinc-500 text-2xl flex items-center justify-center border-2 border-zinc-600 shadow-md"
                    onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowUp'); }}
                    onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowUp'); }}
                >
                    ⬆️
                </button>
                <div className="flex gap-1">
                    <button 
                        className="w-12 h-12 bg-zinc-700 rounded active:bg-zinc-500 text-2xl flex items-center justify-center border-2 border-zinc-600 shadow-md"
                        onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowLeft'); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowLeft'); }}
                    >
                        ⬅️
                    </button>
                    <button 
                        className="w-12 h-12 bg-zinc-700 rounded active:bg-zinc-500 text-2xl flex items-center justify-center border-2 border-zinc-600 shadow-md"
                        onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowDown'); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowDown'); }}
                    >
                        ⬇️
                    </button>
                    <button 
                        className="w-12 h-12 bg-zinc-700 rounded active:bg-zinc-500 text-2xl flex items-center justify-center border-2 border-zinc-600 shadow-md"
                        onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowRight'); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowRight'); }}
                    >
                        ➡️
                    </button>
                </div>
            </div>

            {/* Center Area (Market / Restart) */}
            <div className="flex flex-col items-center justify-center gap-4">
                 <button 
                    className="w-full py-3 bg-yellow-600 rounded text-xs font-bold text-white shadow-lg active:bg-yellow-500 border-b-4 border-yellow-800 active:border-b-0 active:translate-y-1"
                    onClick={() => handleTouchStart('KeyM')}
                 >
                    MARKET
                 </button>
                 
                 {/* Shop Controls - Only visible when in shop */}
                 {uiGameState === GameState.SHOP && (
                     <div className="grid grid-cols-2 gap-1 w-full">
                         {[1, 2, 3, 4].map(num => (
                             <button
                                key={num}
                                className="bg-blue-600 text-white text-[10px] p-1 rounded"
                                onClick={() => buyItem(num)}
                             >
                                 {num}
                             </button>
                         ))}
                     </div>
                 )}

                 {/* Restart Button - Only visible on Game Over */}
                 {uiGameState === GameState.GAME_OVER && (
                     <button 
                        className="w-full py-3 bg-blue-600 rounded text-xs font-bold text-white shadow-lg active:bg-blue-500 animate-pulse"
                        onClick={() => handleTouchStart('KeyR')}
                     >
                        RESTART
                     </button>
                 )}
            </div>

            {/* Action Area */}
            <div className="flex items-center justify-center">
                 <button 
                    className="w-20 h-20 rounded-full bg-red-600 border-4 border-red-800 shadow-lg active:bg-red-500 active:scale-95 flex items-center justify-center"
                    onTouchStart={(e) => { e.preventDefault(); handleTouchStart('Space'); }}
                    onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('Space'); }}
                >
                    <div className="text-white font-bold text-xs">FIRE</div>
                </button>
            </div>
        </div>
    </div>
  );
};
