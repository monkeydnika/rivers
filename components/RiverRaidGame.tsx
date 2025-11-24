
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

  // User IP Cache (Simple)
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

  // --- Initialization & IP Fetch ---
  useEffect(() => {
    // 1. Simple IP Fetch (Non-blocking)
    fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => { 
            userIpRef.current = data.ip; 
            console.log("IP Cached:", data.ip);
        })
        .catch(err => console.log("IP fetch failed (adblocker likely), continuing without IP."));

    // 2. Init Audio on interaction
    const initAudio = () => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    };
    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });
    window.addEventListener('touchstart', initAudio, { once: true });

    // 3. Cleanup on unmount
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
    state.current.riverSegments = []; 
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

    // Cleanup
    s.enemies = s.enemies.filter(e => !e.markedForDeletion);
    s.bullets = s.bullets.filter(b => !b.markedForDeletion);
    s.particles = s.particles.filter(p => !p.markedForDeletion);
  };

  const checkCollision = (rect1: any, rect2: any) => {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
  };

  const killPlayer = (reason: string) => {
      console.log("Game Over:", reason);
      state.current.gameState = GameState.GAME_OVER;
      setUiGameState(GameState.GAME_OVER);
      cancelAnimationFrame(requestRef.current);
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    // Clear
    ctx.fillStyle = '#228B22'; // Grass color
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const s = state.current;

    // River
    ctx.fillStyle = '#4169E1';
    ctx.beginPath();
    if (s.riverSegments.length > 0) {
        ctx.moveTo(s.riverSegments[0].centerX - s.riverSegments[0].width / 2, s.riverSegments[0].y);
        // Left bank
        for (const seg of s.riverSegments) {
            ctx.lineTo(seg.centerX - seg.width / 2, seg.y);
        }
        // Right bank (reverse)
        for (let i = s.riverSegments.length - 1; i >= 0; i--) {
            const seg = s.riverSegments[i];
            ctx.lineTo(seg.centerX + seg.width / 2, seg.y);
        }
    }
    ctx.fill();

    // Decorations
    s.decorations.forEach(d => {
        if (d.type === DecorationType.TREE) {
            ctx.fillStyle = '#006400';
            ctx.beginPath();
            ctx.arc(d.x, d.y, 10, 0, Math.PI * 2);
            ctx.fill();
        } else {
             ctx.fillStyle = '#8B4513';
             ctx.fillRect(d.x - 8, d.y - 8, 16, 16);
        }
    });

    // Player
    ctx.fillStyle = 'yellow';
    // Simple jet shape
    ctx.beginPath();
    ctx.moveTo(s.player.x + s.player.width/2, s.player.y);
    ctx.lineTo(s.player.x + s.player.width, s.player.y + s.player.height);
    ctx.lineTo(s.player.x + s.player.width/2, s.player.y + s.player.height - 10);
    ctx.lineTo(s.player.x, s.player.y + s.player.height);
    ctx.closePath();
    ctx.fill();

    // Enemies
    s.enemies.forEach(e => {
        if (e.type === EnemyType.SHIP) ctx.fillStyle = 'white';
        else if (e.type === EnemyType.HELICOPTER) ctx.fillStyle = 'black';
        else if (e.type === EnemyType.JET) ctx.fillStyle = 'red';
        else if (e.type === EnemyType.FUEL_DEPOT) ctx.fillStyle = '#FF4500';
        else if (e.type === EnemyType.BRIDGE) ctx.fillStyle = '#333';
        else if (e.type === EnemyType.GOLD_COIN) ctx.fillStyle = 'gold';

        if (e.type === EnemyType.GOLD_COIN) {
            ctx.beginPath();
            ctx.arc(e.x + e.width/2, e.y + e.height/2, 10, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(e.x, e.y, e.width, e.height);
        }

        if (e.type === EnemyType.FUEL_DEPOT) {
            ctx.fillStyle = 'white';
            ctx.font = '10px monospace';
            ctx.fillText('FUEL', e.x + 2, e.y + 25);
        }
    });

    // Bullets
    ctx.fillStyle = 'yellow';
    s.bullets.forEach(b => {
        ctx.fillRect(b.x, b.y, b.width, b.height);
    });

    // Particles
    s.particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    });

    // UI Overlay (Fuel)
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(10, CANVAS_HEIGHT - 40, 150, 30);
    
    ctx.fillStyle = 'white';
    ctx.font = '12px "Press Start 2P"';
    ctx.fillText(`FUEL`, 20, CANVAS_HEIGHT - 20);
    
    ctx.fillStyle = s.player.fuel < 20 ? 'red' : 'white';
    ctx.fillRect(70, CANVAS_HEIGHT - 32, (s.player.fuel / MAX_FUEL) * 80, 16);

    ctx.fillStyle = 'white';
    ctx.fillText(`SCORE: ${s.player.score}`, 10, 30);
  };

  const gameLoop = () => {
    update();
    const canvas = canvasRef.current;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) draw(ctx);
    }
    if (state.current.gameState === GameState.PLAYING) {
        requestRef.current = requestAnimationFrame(gameLoop);
    }
  };

  // --- Database & Leaderboard ---

  const fetchLeaderboard = async () => {
      if (!supabase) return;
      setLoadingScores(true);
      const { data, error } = await supabase
          .from('scores')
          .select('name, score')
          .order('score', { ascending: false })
          .limit(MAX_LEADERBOARD_ENTRIES);
      
      if (error) {
          console.error("Supabase fetch error:", error);
      } else {
          setLeaderboard(data || []);
      }
      setLoadingScores(false);
  };

  const saveScore = async () => {
    if (!supabase) {
        setSaveStatus("Config Error: No DB");
        return;
    }
    if (!inputValue.trim()) return;

    setSaveStatus("Saving...");
    const { error } = await supabase.from('scores').insert([{
        name: inputValue.trim(),
        score: state.current.player.score,
        ip_address: userIpRef.current // Include IP
    }]);

    if (error) {
        console.error("Supabase insert error:", error);
        if (error.code === "42P01") {
            setShowSqlModal(true);
            setSaveStatus("Table Missing!");
        } else {
            setSaveStatus("Error Saving");
        }
    } else {
        setSaveStatus("Saved!");
        setUiGameState(GameState.LEADERBOARD_INPUT); 
        fetchLeaderboard();
    }
  };

  // --- Joystick Events ---
  const handleTouchStart = (e: React.TouchEvent) => {
      if (uiGameState !== GameState.PLAYING || controlMode !== 'JOYSTICK') return;
      const touch = e.touches[0];
      const rect = joystickContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const x = touch.clientX - centerX;
      const y = touch.clientY - centerY;
      
      setIsJoystickActive(true);
      updateJoystick(x, y, rect.width/2);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
      if (!isJoystickActive) return;
      const touch = e.touches[0];
      const rect = joystickContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const x = touch.clientX - centerX;
      const y = touch.clientY - centerY;
      
      updateJoystick(x, y, rect.width/2);
  };
  const handleTouchEnd = () => {
      setIsJoystickActive(false);
      setJoystickPos({ x: 0, y: 0 });
      state.current.joystickVector = { x: 0, y: 0 };
  };
  const updateJoystick = (x: number, y: number, radius: number) => {
      const distance = Math.sqrt(x*x + y*y);
      const maxDist = radius - 20;
      
      let normX = x;
      let normY = y;
      
      if (distance > maxDist) {
          normX = (x / distance) * maxDist;
          normY = (y / distance) * maxDist;
      }
      
      setJoystickPos({ x: normX, y: normY });
      state.current.joystickVector = {
          x: normX / maxDist,
          y: normY / maxDist
      };
  };

  // --- Setup / Fix DB UI ---
  const SqlSetupModal = () => (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
        <div className="bg-zinc-900 border-2 border-yellow-500 p-6 max-w-2xl w-full text-xs md:text-sm font-mono overflow-y-auto max-h-[90vh] shadow-[0_0_20px_rgba(234,179,8,0.3)]">
            <div className="flex justify-between items-center mb-4 border-b border-zinc-700 pb-2">
                <h3 className="text-yellow-400 text-lg">⚠️ Veritabanı Kurulumu</h3>
                <button onClick={() => setShowSqlModal(false)} className="text-red-400 hover:text-red-300">✖ KAPAT</button>
            </div>
            
            <p className="mb-4 text-zinc-300 leading-relaxed">
                Görünüşe göre Supabase'de <strong>"scores"</strong> tablosu eksik veya hatalı.
            </p>

            <ol className="list-decimal pl-5 space-y-3 text-zinc-400 mb-6">
                <li><span className="text-white">Supabase Paneli</span>'ne gidin.</li>
                <li>Sol menüden <span className="text-white">SQL Editor</span> simgesine tıklayın.</li>
                <li><span className="text-white">New Query</span> butonuna basın.</li>
                <li>Aşağıdaki kodu kopyalayıp yapıştırın ve <span className="text-green-400 font-bold">RUN</span> tuşuna basın.</li>
            </ol>

            <div className="bg-black border border-zinc-700 p-4 rounded relative group">
                <code className="block text-green-400 whitespace-pre-wrap break-all text-[10px] md:text-xs">
{`-- 1. Tabloyu Oluştur (Eğer yoksa)
create table if not exists scores (
  id bigint generated by default as identity primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  score bigint not null,
  ip_address text -- Yeni eklenen sütun
);

-- 2. Güvenlik Ayarları
alter table scores enable row level security;

create policy "Enable read access for all users"
on scores for select to anon using (true);

create policy "Enable insert access for all users"
on scores for insert to anon with check (true);

-- 3. Eğer tablo zaten varsa ama 'ip_address' yoksa:
alter table scores add column if not exists ip_address text;`}
                </code>
                <button 
                    onClick={() => navigator.clipboard.writeText(`create table if not exists scores ( id bigint generated by default as identity primary key, created_at timestamp with time zone default timezone('utc'::text, now()) not null, name text not null, score bigint not null, ip_address text ); alter table scores enable row level security; create policy "Enable read access for all users" on scores for select to anon using (true); create policy "Enable insert access for all users" on scores for insert to anon with check (true); alter table scores add column if not exists ip_address text;`)}
                    className="absolute top-2 right-2 bg-zinc-800 hover:bg-zinc-700 text-white px-2 py-1 text-xs rounded border border-zinc-600 transition-colors"
                >
                    KOPYALA
                </button>
            </div>
            
            <div className="mt-6 text-center">
                <p className="text-zinc-500 mb-2">Kodu çalıştırdıktan sonra:</p>
                <button 
                    onClick={() => { setShowSqlModal(false); window.location.reload(); }}
                    className="bg-yellow-600 hover:bg-yellow-500 text-black font-bold py-2 px-6 rounded transition-transform active:scale-95"
                >
                    SAYFAYI YENİLE
                </button>
            </div>
        </div>
    </div>
  );

  // --- Render ---
  return (
    <div className="relative w-full h-full bg-black overflow-hidden flex flex-col">
      {showSqlModal && <SqlSetupModal />}
      
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full h-auto object-contain max-h-[80vh] mx-auto block bg-[#228B22]"
      />

      {uiGameState === GameState.START && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
          <h2 className="text-4xl text-yellow-400 mb-8 animate-pulse">RIVER RAID</h2>
          <button 
            onClick={startGame}
            className="px-8 py-4 bg-red-600 text-white text-xl font-bold rounded hover:bg-red-500 transition-colors mb-4 border-4 border-red-800"
          >
            START MISSION
          </button>
          <div className="flex gap-4 mt-4">
             <button onClick={() => setControlMode('BUTTONS')} className={`px-3 py-1 text-xs ${controlMode==='BUTTONS' ? 'bg-zinc-600 text-white':'bg-zinc-900 text-zinc-500'}`}>KEYS</button>
             <button onClick={() => setControlMode('JOYSTICK')} className={`px-3 py-1 text-xs ${controlMode==='JOYSTICK' ? 'bg-zinc-600 text-white':'bg-zinc-900 text-zinc-500'}`}>TOUCH</button>
          </div>
          
          {/* Manual Trigger for Setup */}
          <button 
             onClick={() => setShowSqlModal(true)}
             className="mt-8 text-[10px] text-zinc-600 hover:text-zinc-400 underline"
          >
             Veritabanı Kurulumu
          </button>

          {/* Simple IP Display */}
          <div className="absolute bottom-2 right-2 text-[8px] text-zinc-700 font-mono">
             IP: {userIpRef.current || "Scanning..."}
          </div>
        </div>
      )}

      {uiGameState === GameState.GAME_OVER && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20 p-4">
          <h2 className="text-3xl text-red-500 mb-4">GAME OVER</h2>
          <p className="text-white mb-6">FINAL SCORE: {state.current.player.score}</p>
          
          <div className="flex flex-col gap-2 w-full max-w-xs mb-6">
            <input 
              type="text" 
              maxLength={10}
              placeholder="ENTER NAME" 
              className="bg-zinc-800 border-2 border-zinc-600 p-2 text-center text-white uppercase"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.toUpperCase())}
            />
            <button 
              onClick={saveScore}
              disabled={!inputValue || !!saveStatus}
              className="bg-green-700 hover:bg-green-600 disabled:bg-zinc-800 text-white p-2 rounded font-bold transition-colors"
            >
              {saveStatus || "SAVE RECORD"}
            </button>
          </div>

          <button 
            onClick={startGame}
            className="px-6 py-2 bg-yellow-600 text-black font-bold rounded hover:bg-yellow-500"
          >
            TRY AGAIN
          </button>
          
          <div className="mt-4 text-[10px] text-zinc-500">
             {userIpRef.current ? `Logged as: ${userIpRef.current}` : "IP Hidden (AdBlock)"}
          </div>
        </div>
      )}

      {uiGameState === GameState.LEADERBOARD_INPUT && (
         <div className="absolute inset-0 flex flex-col items-center justify-start bg-zinc-900 z-20 p-8 overflow-y-auto">
            <h2 className="text-2xl text-yellow-400 mb-6">TOP PILOTS</h2>
            {loadingScores ? (
                <p className="text-zinc-500">Loading data...</p>
            ) : (
                <table className="w-full max-w-md text-left text-sm">
                    <thead>
                        <tr className="text-zinc-500 border-b border-zinc-700">
                            <th className="pb-2">RANK</th>
                            <th className="pb-2">PILOT</th>
                            <th className="pb-2 text-right">SCORE</th>
                        </tr>
                    </thead>
                    <tbody className="font-mono">
                        {leaderboard.map((entry, idx) => (
                            <tr key={idx} className={idx < 3 ? "text-yellow-200" : "text-zinc-300"}>
                                <td className="py-2 text-zinc-500">#{idx + 1}</td>
                                <td className="py-2">{entry.name}</td>
                                <td className="py-2 text-right text-green-400">{entry.score}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <button 
                onClick={startGame}
                className="mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded"
            >
                NEW MISSION
            </button>
         </div>
      )}

      {controlMode === 'JOYSTICK' && uiGameState === GameState.PLAYING && (
          <div 
            ref={joystickContainerRef}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 w-32 h-32 bg-white/10 rounded-full border-2 border-white/30 touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
              <div 
                className="absolute w-12 h-12 bg-red-500/80 rounded-full shadow-lg pointer-events-none"
                style={{
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${joystickPos.x}px), calc(-50% + ${joystickPos.y}px))`
                }}
              />
          </div>
      )}
    </div>
  );
};
