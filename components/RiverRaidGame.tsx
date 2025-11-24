
import React, { useEffect, useRef, useState } from 'react';
import { GameState, Player, Enemy, EnemyType, Bullet, Particle, LeaderboardEntry, WeaponType, Decoration, DecorationType } from '../types';
import { supabase } from '../supabaseClient';

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
const MAX_LEADERBOARD_ENTRIES = 20;

export const RiverRaidGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  
  // UI State
  const [uiGameState, setUiGameState] = useState<GameState>(GameState.START);
  const [inputValue, setInputValue] = useState("");
  const [loadingScores, setLoadingScores] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [saveStatus, setSaveStatus] = useState<string>(""); 
  
  // Debug / Setup State
  const [showSqlModal, setShowSqlModal] = useState(false);

  // Input Controls State
  const [controlMode, setControlMode] = useState<'JOYSTICK' | 'BUTTONS'>('BUTTONS');

  // Joystick State
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const joystickContainerRef = useRef<HTMLDivElement>(null);

  // Audio Context
  const audioCtxRef = useRef<AudioContext | null>(null);

  // User IP Cache
  const userIpRef = useRef<string | null>(null);

  // Game State Reference (Mutable for performance)
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
      lives: 5,
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
    decorations: [] as Decoration[],
    riverSegments: [] as { y: number, centerX: number, width: number }[],
    frameCount: 0,
    scrollSpeed: BASE_SCROLL_SPEED,
    distanceTraveled: 0,
    level: 1,
    lastBridgePos: 0,
    isBossActive: false,
    joystickVector: { x: 0, y: 0 },
    lastShotTime: 0
  });

  // --- Simple IP Fetching ---
  useEffect(() => {
    const getIp = async () => {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            if (response.ok) {
                const data = await response.json();
                userIpRef.current = data.ip;
                console.log("IP Detected:", data.ip);
            }
        } catch (error) {
            console.error("IP Fetch error:", error);
            // Fail silently, game continues
        }
    };
    getIp();

    // Init Audio on interaction
    const initAudio = () => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    };
    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });
    window.addEventListener('touchstart', initAudio, { once: true });

    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        if (audioCtxRef.current) audioCtxRef.current.close();
    }
  }, []);

  // --- Sound Synthesis ---
  const playSound = (type: 'shoot' | 'explosion' | 'fuel' | 'coin') => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'shoot') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'explosion') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.3);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'fuel') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'coin') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.setValueAtTime(1600, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  };

  // --- Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      state.current.keys[e.code] = true;
      if (uiGameState === GameState.START || uiGameState === GameState.GAME_OVER) {
         if (e.code === 'KeyR' || e.code === 'Enter') startGame();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      state.current.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [uiGameState]);

  // --- Game Loop ---
  const startGame = () => {
    state.current = {
      ...state.current,
      gameState: GameState.PLAYING,
      player: {
        x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
        y: CANVAS_HEIGHT - 120,
        width: PLAYER_WIDTH,
        height: PLAYER_HEIGHT,
        vx: 0,
        vy: 0,
        speedY: 0,
        fuel: MAX_FUEL,
        lives: 5,
        score: 0,
        gold: 0,
        isInvulnerable: false,
        invulnerableTimer: 0,
        markedForDeletion: false,
        weaponType: WeaponType.SINGLE,
      },
      bullets: [],
      enemies: [],
      particles: [],
      riverSegments: [],
      decorations: [],
      frameCount: 0,
      scrollSpeed: BASE_SCROLL_SPEED,
      distanceTraveled: 0,
      level: 1,
      lastBridgePos: 0,
      isBossActive: false,
      joystickVector: { x: 0, y: 0 },
      lastShotTime: 0
    };

    setUiGameState(GameState.PLAYING);
    setSaveStatus("");
    
    // Initial river generation
    for (let i = 0; i < CANVAS_HEIGHT / RIVER_SEGMENT_HEIGHT + 5; i++) {
        generateRiverSegment(CANVAS_HEIGHT - i * RIVER_SEGMENT_HEIGHT);
    }

    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const generateRiverSegment = (y: number) => {
    const segments = state.current.riverSegments;
    let centerX = CANVAS_WIDTH / 2;
    let width = 300; 

    if (segments.length > 0) {
        const last = segments[segments.length - 1];
        const time = state.current.frameCount * 0.01;
        const noise = Math.sin(time) * 20 + Math.sin(time * 0.5) * 40;
        centerX = CANVAS_WIDTH / 2 + noise;
        width = 250 + Math.sin(time * 0.3) * 100;
        centerX = Math.max(width/2 + 20, Math.min(CANVAS_WIDTH - width/2 - 20, centerX));
    }

    state.current.riverSegments.push({ y, centerX, width });

    if (Math.random() < 0.3) {
        const isLeft = Math.random() > 0.5;
        const bankX = isLeft ? (centerX - width/2 - 20) : (centerX + width/2 + 20);
        state.current.decorations.push({
            x: bankX,
            y: y,
            type: Math.random() > 0.8 ? DecorationType.HOUSE : DecorationType.TREE,
            variant: Math.floor(Math.random() * 2), 
            markedForDeletion: false
        });
    }
  };

  const spawnEnemy = (y: number) => {
     if (state.current.isBossActive) return;

     const rand = Math.random();
     const segments = state.current.riverSegments;
     const segment = segments[segments.length - 1]; 
     if (!segment) return;
     
     const minX = segment.centerX - segment.width / 2 + 20;
     const maxX = segment.centerX + segment.width / 2 - 20;
     const x = minX + Math.random() * (maxX - minX);

     let type = EnemyType.SHIP;
     let hp = 1;

     if (state.current.distanceTraveled - state.current.lastBridgePos > 2000) {
         type = EnemyType.BRIDGE;
         hp = 10;
         state.current.lastBridgePos = state.current.distanceTraveled;
         state.current.enemies.push({
            type, x: segment.centerX - 64, y, width: 128, height: 40, vx: 0, vy: 0, shootTimer: 0, hp, maxHp: hp, markedForDeletion: false
         });
         return;
     }

     if (rand < 0.02) {
         type = EnemyType.FUEL_DEPOT;
         hp = 1;
     } else if (rand < 0.05) {
         type = EnemyType.HELICOPTER;
         hp = 2;
     } else if (rand < 0.07) {
         type = EnemyType.JET;
         hp = 1;
     } else if (rand < 0.08) {
        type = EnemyType.GOLD_COIN;
        hp = 1;
     } else {
         return; 
     }

     state.current.enemies.push({
         type,
         x,
         y,
         width: type === EnemyType.FUEL_DEPOT ? 24 : 32,
         height: type === EnemyType.FUEL_DEPOT ? 48 : 32,
         vx: type === EnemyType.HELICOPTER ? (Math.random() > 0.5 ? 2 : -2) : 0,
         vy: 0,
         shootTimer: 0,
         hp,
         maxHp: hp,
         markedForDeletion: false
     });
  };

  const createExplosion = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
        state.current.particles.push({
            x, y,
            width: 4, height: 4,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1.0,
            color,
            size: Math.random() * 4 + 2,
            markedForDeletion: false
        });
    }
    playSound('explosion');
  };

  const update = () => {
    const s = state.current;
    s.frameCount++;

    const keys = s.keys;
    let dx = 0;

    // Keyboard
    if (keys['ArrowLeft']) dx = -5;
    if (keys['ArrowRight']) dx = 5;
    
    // Joystick
    if (isJoystickActive) {
        dx = s.joystickVector.x * 6; 
        if (s.joystickVector.y < -0.3) s.scrollSpeed = Math.min(s.scrollSpeed + 0.1, BASE_SCROLL_SPEED * 2.5);
        if (s.joystickVector.y > 0.3) s.scrollSpeed = Math.max(s.scrollSpeed - 0.1, BASE_SCROLL_SPEED * 0.5);
    } else {
        if (keys['ArrowUp']) s.scrollSpeed = Math.min(s.scrollSpeed + 0.1, BASE_SCROLL_SPEED * 2.5);
        else if (keys['ArrowDown']) s.scrollSpeed = Math.max(s.scrollSpeed - 0.1, BASE_SCROLL_SPEED * 0.5);
        else {
             if (s.scrollSpeed > BASE_SCROLL_SPEED) s.scrollSpeed -= 0.05;
             if (s.scrollSpeed < BASE_SCROLL_SPEED) s.scrollSpeed += 0.05;
        }
    }

    s.player.x += dx;

    // Shooting
    const now = Date.now();
    if ((keys['Space'] || keys['KeyZ'] || isJoystickActive) && now - s.lastShotTime > 200) { 
       s.bullets.push({
           x: s.player.x + PLAYER_WIDTH / 2 - 4,
           y: s.player.y,
           width: 8, height: 16,
           vx: 0, vy: -12,
           isEnemy: false,
           markedForDeletion: false
       });
       s.lastShotTime = now;
       playSound('shoot');
    }

    s.player.fuel -= FUEL_CONSUMPTION_RATE * (s.scrollSpeed / BASE_SCROLL_SPEED);
    if (s.player.fuel <= 0) {
        killPlayer("Fuel Empty");
    }

    s.distanceTraveled += s.scrollSpeed;

    // River Generation
    const lastSeg = s.riverSegments[s.riverSegments.length - 1];
    if (lastSeg.y > -RIVER_SEGMENT_HEIGHT) {
        generateRiverSegment(lastSeg.y - RIVER_SEGMENT_HEIGHT);
        spawnEnemy(lastSeg.y - RIVER_SEGMENT_HEIGHT - 50);
    }

    s.riverSegments.forEach(seg => seg.y += s.scrollSpeed);
    if (s.riverSegments[0].y > CANVAS_HEIGHT) s.riverSegments.shift();
    
    s.decorations.forEach(d => {
        d.y += s.scrollSpeed;
        if (d.y > CANVAS_HEIGHT) d.markedForDeletion = true;
    });
    s.decorations = s.decorations.filter(d => !d.markedForDeletion);

    // Collision Player vs River Banks
    const playerSeg = s.riverSegments.find(seg => 
        s.player.y + s.player.height > seg.y && s.player.y < seg.y + RIVER_SEGMENT_HEIGHT
    );
    if (playerSeg) {
        const leftBank = playerSeg.centerX - playerSeg.width / 2;
        const rightBank = playerSeg.centerX + playerSeg.width / 2;
        if (s.player.x < leftBank || s.player.x + s.player.width > rightBank) {
            killPlayer("Crashed into land");
        }
    }

    // Enemies
    s.enemies.forEach(e => {
        e.y += s.scrollSpeed;
        e.x += e.vx;

        if (e.type === EnemyType.HELICOPTER) {
             const seg = s.riverSegments.find(seg => e.y > seg.y && e.y < seg.y + RIVER_SEGMENT_HEIGHT);
             if (seg) {
                 if (e.x < seg.centerX - seg.width/2 + 20) e.vx = Math.abs(e.vx);
                 if (e.x + e.width > seg.centerX + seg.width/2 - 20) e.vx = -Math.abs(e.vx);
             }
        }
        
        if (e.type === EnemyType.JET) e.y += 2; 

        if (e.type === EnemyType.BRIDGE && !e.markedForDeletion) {
             if (checkCollision(s.player, e)) killPlayer("Crashed into bridge");
        } else if (e.type === EnemyType.FUEL_DEPOT) {
             if (checkCollision(s.player, e)) {
                 s.player.fuel = Math.min(s.player.fuel + FUEL_REFILL_RATE, MAX_FUEL);
                 playSound('fuel');
             }
        } else if (e.type === EnemyType.GOLD_COIN) {
            if (checkCollision(s.player, e)) {
                s.player.score += 500;
                s.player.gold += 1;
                e.markedForDeletion = true;
                playSound('coin');
            }
        } else if (e.type !== EnemyType.BRIDGE) {
            if (checkCollision(s.player, e)) {
                killPlayer("Crashed into enemy");
                e.markedForDeletion = true;
                createExplosion(e.x, e.y, 'orange', 10);
            }
        }

        if (e.y > CANVAS_HEIGHT) e.markedForDeletion = true;
    });

    // Bullets
    s.bullets.forEach(b => {
        b.x += b.vx;
        b.y += b.vy;

        s.enemies.forEach(e => {
            if (!e.markedForDeletion && !b.markedForDeletion && checkCollision(b, e)) {
                if (e.type === EnemyType.GOLD_COIN) return; 

                b.markedForDeletion = true;
                e.hp--;
                if (e.hp <= 0) {
                    e.markedForDeletion = true;
                    if (e.type === EnemyType.BRIDGE) {
                        s.player.score += 500;
                        createExplosion(e.x + e.width/2, e.y + e.height/2, 'gray', 30);
                    } else if (e.type === EnemyType.FUEL_DEPOT) {
                        s.player.score += 80;
                        createExplosion(e.x, e.y, 'red', 15);
                    } else {
                        s.player.score += 100;
                        createExplosion(e.x, e.y, 'orange', 10);
                    }
                }
            }
        });

        if (b.y < 0 || b.y > CANVAS_HEIGHT) b.markedForDeletion = true;
    });

    s.particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if (p.life <= 0) p.markedForDeletion = true;
    });

    s.bullets = s.bullets.filter(b => !b.markedForDeletion);
    s.enemies = s.enemies.filter(e => !e.markedForDeletion);
    s.particles = s.particles.filter(p => !p.markedForDeletion);

    if (s.frameCount % 60 === 0) s.player.score += 10;
  };

  const killPlayer = (reason: string) => {
      console.log("Dead:", reason);
      const s = state.current;
      createExplosion(s.player.x, s.player.y, 'yellow', 50);
      s.player.lives--;
      
      if (s.player.lives > 0) {
          const seg = s.riverSegments.find(seg => seg.y > CANVAS_HEIGHT - 200 && seg.y < CANVAS_HEIGHT - 100) || s.riverSegments[0];
          s.player.x = seg.centerX - PLAYER_WIDTH/2;
          s.player.y = CANVAS_HEIGHT - 120;
          s.player.vx = 0;
          s.player.fuel = MAX_FUEL;
      } else {
          setUiGameState(GameState.GAME_OVER);
      }
  };

  const checkCollision = (r1: any, r2: any) => {
      return (r1.x < r2.x + r2.width &&
              r1.x + r1.width > r2.x &&
              r1.y < r2.y + r2.height &&
              r1.y + r1.height > r2.y);
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = state.current;

    ctx.fillStyle = '#0066cc';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#228822';
    s.riverSegments.forEach(seg => {
        const leftBankW = seg.centerX - seg.width/2;
        const rightBankX = seg.centerX + seg.width/2;
        ctx.fillRect(0, seg.y, leftBankW, RIVER_SEGMENT_HEIGHT + 1); 
        ctx.fillRect(rightBankX, seg.y, CANVAS_WIDTH - rightBankX, RIVER_SEGMENT_HEIGHT + 1);
        ctx.fillStyle = '#888888';
        ctx.fillRect(leftBankW - 4, seg.y, 4, RIVER_SEGMENT_HEIGHT + 1);
        ctx.fillRect(rightBankX, seg.y, 4, RIVER_SEGMENT_HEIGHT + 1);
        ctx.fillStyle = '#228822';
    });

    s.decorations.forEach(d => {
        ctx.fillStyle = d.type === DecorationType.TREE ? '#004400' : '#884400';
        if (d.type === DecorationType.TREE) {
            ctx.beginPath();
            ctx.moveTo(d.x, d.y + 16);
            ctx.lineTo(d.x + 8, d.y);
            ctx.lineTo(d.x + 16, d.y + 16);
            ctx.fill();
        } else {
             ctx.fillRect(d.x, d.y, 16, 12);
             ctx.fillStyle = '#aa0000'; 
             ctx.beginPath();
             ctx.moveTo(d.x - 2, d.y);
             ctx.lineTo(d.x + 8, d.y - 6);
             ctx.lineTo(d.x + 18, d.y);
             ctx.fill();
        }
    });

    s.enemies.filter(e => e.type === EnemyType.BRIDGE).forEach(b => {
        ctx.fillStyle = '#555';
        ctx.fillRect(0, b.y, CANVAS_WIDTH, b.height);
        ctx.fillStyle = '#000';
        ctx.font = '10px monospace';
        ctx.fillText("BRIDGE", b.x + 10, b.y + 20);
    });

    s.enemies.forEach(e => {
        if (e.type === EnemyType.BRIDGE) return;
        ctx.save();
        ctx.translate(e.x + e.width/2, e.y + e.height/2);
        
        if (e.type === EnemyType.SHIP) {
            ctx.fillStyle = '#444';
            ctx.fillRect(-e.width/2, -e.height/2, e.width, e.height);
            ctx.fillStyle = '#888';
            ctx.fillRect(-e.width/4, -e.height/2 + 4, e.width/2, e.height - 8);
        } else if (e.type === EnemyType.HELICOPTER) {
            ctx.fillStyle = '#aa44aa';
            ctx.beginPath();
            ctx.arc(0, 0, e.width/2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillRect(-e.width, -2, e.width*2, 4);
            ctx.fillRect(-2, -e.width, 4, e.width*2);
        } else if (e.type === EnemyType.JET) {
             ctx.fillStyle = '#white';
             ctx.beginPath();
             ctx.moveTo(0, -e.height/2);
             ctx.lineTo(e.width/2, e.height/2);
             ctx.lineTo(0, e.height/4);
             ctx.lineTo(-e.width/2, e.height/2);
             ctx.fill();
        } else if (e.type === EnemyType.FUEL_DEPOT) {
             ctx.fillStyle = '#ff6666';
             ctx.fillRect(-e.width/2, -e.height/2, e.width, e.height);
             ctx.fillStyle = '#fff';
             ctx.font = '10px monospace';
             ctx.fillText("FUEL", -10, 4);
        } else if (e.type === EnemyType.GOLD_COIN) {
            ctx.fillStyle = '#ffd700';
            ctx.beginPath();
            ctx.arc(0, 0, e.width/2, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = '#daa520';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("$", 0, 1);
        }
        ctx.restore();
    });

    ctx.fillStyle = '#ffff00';
    const p = s.player;
    ctx.save();
    ctx.translate(p.x + p.width/2, p.y + p.height/2);
    ctx.beginPath();
    ctx.moveTo(0, -p.height/2);
    ctx.lineTo(p.width/2, p.height/2);
    ctx.lineTo(0, p.height/2 - 5);
    ctx.lineTo(-p.width/2, p.height/2);
    ctx.fill();
    ctx.fillStyle = Math.random() > 0.5 ? 'orange' : 'red';
    ctx.beginPath();
    ctx.moveTo(-4, p.height/2 - 5);
    ctx.lineTo(4, p.height/2 - 5);
    ctx.lineTo(0, p.height/2 + 10 + Math.random() * 5);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#fff';
    s.bullets.forEach(b => {
        ctx.fillRect(b.x, b.y, b.width, b.height);
    });

    s.particles.forEach(pt => {
        ctx.globalAlpha = pt.life;
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
        ctx.globalAlpha = 1.0;
    });

    ctx.fillStyle = '#000';
    ctx.fillRect(0, CANVAS_HEIGHT - 60, CANVAS_WIDTH, 60);
    ctx.fillStyle = '#fff';
    ctx.font = '20px "Press Start 2P", cursive'; 
    ctx.fillText(`SCORE: ${s.player.score}`, 20, CANVAS_HEIGHT - 25);
    ctx.fillText(`LIVES: ${s.player.lives}`, 400, CANVAS_HEIGHT - 25);
    
    ctx.fillStyle = '#444';
    ctx.fillRect(150, CANVAS_HEIGHT - 45, 200, 20);
    const fuelPct = s.player.fuel / MAX_FUEL;
    ctx.fillStyle = fuelPct < 0.2 ? 'red' : 'yellow';
    ctx.fillRect(152, CANVAS_HEIGHT - 43, 196 * fuelPct, 16);
    ctx.fillStyle = '#000';
    ctx.font = '10px monospace';
    ctx.fillText("FUEL", 230, CANVAS_HEIGHT - 32);
  };

  const gameLoop = () => {
      if (state.current.gameState === GameState.PLAYING) {
          update();
      }
      draw();
      requestRef.current = requestAnimationFrame(gameLoop);
  };

  // --- Supabase / Leaderboard ---
  const submitScore = async () => {
    if (!inputValue.trim()) return;
    if (!supabase) {
        setSaveStatus("Supabase not configured!");
        return;
    }
    setLoadingScores(true);
    setSaveStatus("Saving...");

    try {
        const { error } = await supabase
            .from('scores')
            .insert([
                { 
                    name: inputValue, 
                    score: state.current.player.score,
                    ip_address: userIpRef.current || null
                }
            ]);

        if (error) {
            console.error("Supabase Error:", error);
            if (error.code === '42P01') {
                setShowSqlModal(true);
                setSaveStatus("Error: Table missing!");
            } else {
                setSaveStatus(`Error: ${error.message}`);
            }
        } else {
            setSaveStatus("Saved!");
            fetchLeaderboard();
            setUiGameState(GameState.START);
        }
    } catch (err: any) {
        setSaveStatus(`Net Error: ${err.message}`);
    } finally {
        setLoadingScores(false);
    }
  };

  const fetchLeaderboard = async () => {
      if (!supabase) return;
      setLoadingScores(true);
      const { data, error } = await supabase
        .from('scores')
        .select('name, score')
        .order('score', { ascending: false })
        .limit(MAX_LEADERBOARD_ENTRIES);

      if (error) {
          console.error("Fetch Error:", error);
      } else {
          setLeaderboard(data || []);
      }
      setLoadingScores(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!joystickContainerRef.current) return;
    const rect = joystickContainerRef.current.getBoundingClientRect();
    setJoystickPos({
        x: touch.clientX - rect.left - rect.width/2,
        y: touch.clientY - rect.top - rect.height/2
    });
    setIsJoystickActive(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
      if (!isJoystickActive || !joystickContainerRef.current) return;
      const touch = e.touches[0];
      const rect = joystickContainerRef.current.getBoundingClientRect();
      let x = touch.clientX - rect.left - rect.width/2;
      let y = touch.clientY - rect.top - rect.height/2;
      
      const maxDist = 40;
      const dist = Math.sqrt(x*x + y*y);
      if (dist > maxDist) {
          x = (x / dist) * maxDist;
          y = (y / dist) * maxDist;
      }
      
      setJoystickPos({ x, y });
      state.current.joystickVector = { x: x/maxDist, y: y/maxDist };
  };

  const handleTouchEnd = () => {
      setIsJoystickActive(false);
      setJoystickPos({ x: 0, y: 0 });
      state.current.joystickVector = { x: 0, y: 0 };
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    fetchLeaderboard();
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full h-auto max-h-[80vh] object-contain bg-blue-900 cursor-crosshair"
      />

      {/* UI OVERLAYS */}
      {uiGameState === GameState.START && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-4">
              <h1 className="text-4xl text-yellow-400 mb-4 font-bold tracking-widest text-center">RIVER STRIKE</h1>
              <p className="mb-8 text-zinc-400 text-xs animate-pulse">PRESS ENTER TO START</p>
              
              <button 
                onClick={startGame}
                className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded shadow-[0_4px_0_rgb(20,80,20)] active:shadow-none active:translate-y-1 mb-4"
              >
                  START MISSION
              </button>

              <div className="flex gap-2 mb-4">
                  <button onClick={() => setControlMode('BUTTONS')} className={`text-xs px-2 py-1 border ${controlMode === 'BUTTONS' ? 'bg-white text-black' : 'text-zinc-500'}`}>KEYBOARD</button>
                  <button onClick={() => setControlMode('JOYSTICK')} className={`text-xs px-2 py-1 border ${controlMode === 'JOYSTICK' ? 'bg-white text-black' : 'text-zinc-500'}`}>TOUCH</button>
              </div>

              <button 
                onClick={() => setShowSqlModal(true)}
                className="text-[10px] text-zinc-600 underline hover:text-zinc-400 mt-4"
              >
                Veritabanı Kurulumu (SQL)
              </button>

              <div className="mt-4 p-4 border border-zinc-800 bg-zinc-900/80 rounded max-w-xs w-full">
                  <h3 className="text-xs text-yellow-500 mb-2 text-center border-b border-zinc-700 pb-1">TOP ACES</h3>
                  {loadingScores ? <p className="text-[10px] text-center">Loading...</p> : (
                      <ul className="text-[10px] space-y-1">
                          {leaderboard.length === 0 && <li className="text-zinc-600 text-center">No records yet</li>}
                          {leaderboard.slice(0, 5).map((entry, i) => (
                              <li key={i} className="flex justify-between">
                                  <span>{i+1}. {entry.name.substring(0, 10)}</span>
                                  <span className="text-yellow-200">{entry.score}</span>
                              </li>
                          ))}
                      </ul>
                  )}
              </div>
          </div>
      )}

      {uiGameState === GameState.GAME_OVER && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-white p-6">
              <h2 className="text-3xl text-red-500 mb-2">GAME OVER</h2>
              <p className="text-xl mb-6">SCORE: {state.current.player.score}</p>
              
              <div className="flex flex-col gap-2 w-full max-w-xs">
                  <input 
                    type="text" 
                    maxLength={10}
                    placeholder="ENTER NAME" 
                    className="bg-zinc-800 border border-zinc-600 p-2 text-center text-white uppercase"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                  />
                  <button 
                    onClick={submitScore}
                    disabled={loadingScores || !inputValue}
                    className="bg-yellow-600 hover:bg-yellow-500 text-black font-bold py-2 px-4 rounded disabled:opacity-50"
                  >
                      {loadingScores ? "SAVING..." : "SAVE RECORD"}
                  </button>
                  {saveStatus && <p className="text-[10px] text-center text-yellow-200 mt-1">{saveStatus}</p>}
                  
                  <button 
                    onClick={() => setUiGameState(GameState.START)}
                    className="mt-4 text-xs text-zinc-500 hover:text-white"
                  >
                      BACK TO MENU
                  </button>
              </div>
          </div>
      )}

      {controlMode === 'JOYSTICK' && uiGameState === GameState.PLAYING && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-32 h-32 bg-white/10 rounded-full backdrop-blur-sm border border-white/20 touch-none"
               ref={joystickContainerRef}
               onTouchStart={handleTouchStart}
               onTouchMove={handleTouchMove}
               onTouchEnd={handleTouchEnd}
          >
              <div className="absolute w-12 h-12 bg-yellow-400/80 rounded-full shadow-lg pointer-events-none transition-transform duration-75"
                   style={{ 
                       left: '50%', top: '50%', 
                       marginLeft: '-24px', marginTop: '-24px',
                       transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`
                   }}
              />
          </div>
      )}
      
      {controlMode === 'JOYSTICK' && uiGameState === GameState.PLAYING && (
          <button 
             className="absolute bottom-10 right-4 w-16 h-16 bg-red-600/80 rounded-full border-4 border-red-800 active:bg-red-500 flex items-center justify-center text-white font-bold text-xs select-none"
             onTouchStart={() => { state.current.keys['Space'] = true; }}
             onTouchEnd={() => { state.current.keys['Space'] = false; }}
          >
              FIRE
          </button>
      )}

      {showSqlModal && (
          <div className="absolute inset-0 z-50 bg-black/95 flex flex-col p-4 overflow-y-auto font-mono text-left">
              <div className="flex justify-between items-center mb-4 border-b border-zinc-700 pb-2">
                  <h3 className="text-red-400 font-bold">⚠️ Veritabanı Hatası (42P01)</h3>
                  <button onClick={() => setShowSqlModal(false)} className="text-zinc-400 hover:text-white">✕</button>
              </div>
              
              <div className="text-xs text-zinc-300 space-y-2 mb-4">
                  <p><strong>Sorun:</strong> Supabase'de 'scores' tablosu bulunamadı.</p>
                  <p><strong>Çözüm:</strong> Aşağıdaki adımları takip edin:</p>
                  <ol className="list-decimal list-inside pl-2 space-y-1 text-zinc-400">
                      <li>Supabase Dashboard'a gidin.</li>
                      <li>Sol menüden <strong>SQL Editor</strong>'e tıklayın.</li>
                      <li><strong>New Query</strong> diyerek boş bir sayfa açın.</li>
                      <li>Aşağıdaki kodu kopyalayıp oraya yapıştırın.</li>
                      <li>Sağ alttaki <strong>RUN</strong> butonuna basın.</li>
                  </ol>
              </div>

              <div className="bg-zinc-900 border border-zinc-700 p-2 rounded relative group">
                  <pre className="text-[10px] text-green-400 overflow-x-auto whitespace-pre-wrap">
{`-- 1. Tabloyu oluştur
create table if not exists scores (
  id bigint generated by default as identity primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  score bigint not null,
  ip_address text
);

-- 2. Güvenlik ayarlarını aç
alter table scores enable row level security;

-- 3. Herkesin okumasına izin ver
create policy "Enable read access for all users"
on scores for select
to anon
using (true);

-- 4. Herkesin yazmasına izin ver
create policy "Enable insert access for all users"
on scores for insert
to anon
with check (true);

-- (Opsiyonel) Eğer tablo zaten varsa ve IP sütunu yoksa:
alter table scores add column if not exists ip_address text;
`}
                  </pre>
                  <button 
                    onClick={() => navigator.clipboard.writeText(`create table if not exists scores ( id bigint generated by default as identity primary key, created_at timestamp with time zone default timezone('utc'::text, now()) not null, name text not null, score bigint not null, ip_address text ); alter table scores enable row level security; create policy "Enable read access for all users" on scores for select to anon using (true); create policy "Enable insert access for all users" on scores for insert to anon with check (true); alter table scores add column if not exists ip_address text;`)}
                    className="absolute top-2 right-2 bg-zinc-700 hover:bg-zinc-600 text-white text-[8px] px-2 py-1 rounded"
                  >
                      COPY SQL
                  </button>
              </div>
              
              <button 
                 onClick={() => window.location.reload()}
                 className="mt-4 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-xs"
              >
                  Sayfayı Yenile
              </button>
          </div>
      )}

    </div>
  );
};
