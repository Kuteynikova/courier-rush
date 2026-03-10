// Game Configuration
const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%'
    },
    backgroundColor: '#333333',
    parent: 'game-container',
    zoom: 1,
    physics: {
        default: 'arcade',
        arcade: {
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

new Phaser.Game(config);

// Dynamic sizing based on viewport
let TILE_SIZE = 40;
let MAP_WIDTH = 15;
let MAP_HEIGHT = 27;
let blocksPerWarehouse = 5;

// Enums for map types
const TILE_TYPE = {
    ROAD: 0,
    BUILDING: 1,
    WAREHOUSE: 2,
    HOUSE: 3,
    SIDEWALK: 4,
    HOME: 5
};

// Colors (Avito Palette)
const COLORS = {
    ROAD: 0xcccccc, // Light Grey
    BUILDING: 0xd9d9d9,
    WAREHOUSE: 0x8115ff, // Purple
    HOUSE_ZONE: 0x00d166, // Green
    PLAYER: 0xaefc41, // Light Green (form)
    CAP: 0x000000,
    BOX_YELLOW: 0xffd200,
    BOX_RED: 0xff4141,
    CAR_RED: 0xe63946,
    CAR_BLUE: 0x457b9d
};

// Global State
let mapData = [];
let warehouses = [];
let houses = [];
let graphics;
let playerGraphics;
let tailGraphics;
let entitiesGraphics;
let pulseGraphics;

let cars = [];
const CAR_SPAWN_COUNT = 5; // Reduced to 5
const CAR_SPEED_INTERVAL = 900; // was 700. Slowed down ~30% for mobile

let player;
let playerDir = { x: 0, y: 0 };
let nextDir = { x: 0, y: 0 };
let isMoving = false;
let moveTimer = 0;
const MOVE_INTERVAL = 350; // ms per grid move ~ slowed down for better control, slower for better control
let speedMultiplier = 1.0;
let invulnerableTimer = 0;

let gamePaused = true;
let pulseTimer = 0;

let playerTail = [];
let tailHistory = []; // {x, y, dir}

let score = 0;
let gameTime = 480; // Starts at 08:00 (minutes left instead of minutes passed)
const GAME_END_TIME = 0; // 00:00 (0 minutes left)
let timeTextTimer;

// Audio context (Web Audio API)
let audioCtx;
let pcene;

// Main Scene Functions
function preload() {
    // No external assets required, we draw everything with graphics
}

function create() {
    // Dynamic resize logic
    // We want roughly 15 columns on screen width to match the original feel
    let container = document.getElementById('ui-container');
    let screenW = container.clientWidth;
    let screenH = container.clientHeight;

    // MAP_WIDTH dynamically scales to prevent tiny tiles on small phones
    if (screenW < 500) {
        MAP_WIDTH = 11;
    } else {
        MAP_WIDTH = 15;
    }

    TILE_SIZE = Math.floor(screenW / MAP_WIDTH);

    // MAP_HEIGHT depends on how many TILE_SIZE blocks fit into the screen height
    // Use floor to ensure we don't have partially cut-off tiles at the bottom
    MAP_HEIGHT = Math.floor(screenH / TILE_SIZE);

    // Init Audio Context (resume on first interaction)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.input.on('pointerdown', () => {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    });

    graphics = this.add.graphics();
    tailGraphics = this.add.graphics();
    pulseGraphics = this.add.graphics();
    playerGraphics = this.add.graphics();
    entitiesGraphics = this.add.graphics();

    generateMap(this);
    drawMap();
    initPlayer();
    initCars();

    // Set camera bounds
    pcene = this;
    let cam = this.cameras.main;
    cam.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    // Statically center camera to perfectly align the map without microscopic panning
    cam.scrollX = (MAP_WIDTH * TILE_SIZE - cam.width) / 2;
    cam.scrollY = (MAP_HEIGHT * TILE_SIZE - cam.height) / 2;

    // Setup start button and pause logic
    document.getElementById('btn-start').addEventListener('click', () => {
        document.getElementById('start-screen').style.display = 'none';
        document.getElementById('swipe-hint').style.display = 'block';
        gamePaused = false;
        if (audioCtx.state === 'suspended') audioCtx.resume();
    });

    if (document.getElementById('btn-onboarding')) {
        document.getElementById('btn-onboarding').addEventListener('click', () => {
            document.getElementById('start-screen').style.display = 'none';
            document.getElementById('onboarding-screen').style.display = 'flex';
        });
    }

    window.nextSlide = function (slideNum) {
        document.querySelectorAll('#onboarding-screen .modal').forEach(m => m.style.display = 'none');
        let slide = document.getElementById('slide-' + slideNum);
        if (slide) slide.style.display = 'block';
    };

    if (document.getElementById('btn-finish-onboarding')) {
        document.getElementById('btn-finish-onboarding').addEventListener('click', () => {
            document.getElementById('onboarding-screen').style.display = 'none';
            document.getElementById('swipe-hint').style.display = 'block';
            gamePaused = false;
            if (audioCtx.state === 'suspended') audioCtx.resume();
        });
    }

    document.getElementById('btn-pause').addEventListener('click', () => {
        gamePaused = true;
        document.getElementById('pause-screen').style.display = 'flex';
    });

    document.getElementById('btn-resume').addEventListener('click', () => {
        document.getElementById('pause-screen').style.display = 'none';
        gamePaused = false;
    });

    // Start Game Timer
    timeTextTimer = this.time.addEvent({
        delay: 1000, // 1 real sec = 1 game min
        callback: updateGameTime,
        callbackScope: this,
        loop: true
    });
    // Input handling
    const hideSwipeHint = () => {
        let hint = document.getElementById('swipe-hint');
        if (hint) hint.style.display = 'none';
    };

    this.input.keyboard.on('keydown-UP', () => { hideSwipeHint(); nextDir = { x: 0, y: -1 }; });
    this.input.keyboard.on('keydown-DOWN', () => { hideSwipeHint(); nextDir = { x: 0, y: 1 }; });
    this.input.keyboard.on('keydown-LEFT', () => { hideSwipeHint(); nextDir = { x: -1, y: 0 }; });
    this.input.keyboard.on('keydown-RIGHT', () => { hideSwipeHint(); nextDir = { x: 1, y: 0 }; });

    // Swipe handling
    this.input.on('pointerup', (pointer) => {
        let dx = pointer.upX - pointer.downX;
        let dy = pointer.upY - pointer.downY;

        // Hide hint if a swipe occurred
        if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
            hideSwipeHint();
        }

        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 15) nextDir = { x: 1, y: 0 };
            else if (dx < -15) nextDir = { x: -1, y: 0 };
        } else {
            if (dy > 15) nextDir = { x: 0, y: 1 };
            else if (dy < -15) nextDir = { x: 0, y: -1 };
        }
    });
}

function update(time, delta) {
    if (gameTime <= GAME_END_TIME || gamePaused) return;

    // Removed automatic camera following because the map is procedurally generated 
    // to match viewport bounds. Pan calculation forced fractional jumping.

    pulseTimer += delta;
    drawPulses();

    if (invulnerableTimer > 0) {
        invulnerableTimer -= delta;
        if (invulnerableTimer <= 0) {
            invulnerableTimer = 0;
            drawPlayer(); // Redraw solid
        }
    }

    // Movement logic
    moveTimer += delta;
    let currentInterval = MOVE_INTERVAL / speedMultiplier;

    // Update Cars
    updateCars(delta);

    if (moveTimer >= currentInterval) {
        moveTimer = 0;

        // Attempt to turn if nextDir is set and valid
        let turnedThisFrame = false;
        if (nextDir.x !== 0 || nextDir.y !== 0) {
            let turnX = player.x + nextDir.x;
            let turnY = player.y + nextDir.y;
            if (turnX < 0) turnX = MAP_WIDTH - 1;
            else if (turnX >= MAP_WIDTH) turnX = 0;
            if (turnY < 0) turnY = MAP_HEIGHT - 1;
            else if (turnY >= MAP_HEIGHT) turnY = 0;

            if (canMoveTo(turnX, turnY)) {
                playerDir = { x: nextDir.x, y: nextDir.y };
                // ONLY clear nextDir when the turn is successful
                nextDir = { x: 0, y: 0 };
                isMoving = true;
                turnedThisFrame = true;
            }
        }

        // Move forward if moving
        if (isMoving) {
            let nextX = player.x + playerDir.x;
            let nextY = player.y + playerDir.y;
            if (nextX < 0) nextX = MAP_WIDTH - 1;
            else if (nextX >= MAP_WIDTH) nextX = 0;
            if (nextY < 0) nextY = MAP_HEIGHT - 1;
            else if (nextY >= MAP_HEIGHT) nextY = 0;

            if (canMoveTo(nextX, nextY)) {
                // Save history before moving
                tailHistory.unshift({ x: player.x, y: player.y });
                if (tailHistory.length > playerTail.length + 1) {
                    tailHistory.pop();
                }

                player.x = nextX;
                player.y = nextY;

                checkInteractions();
            } else {
                // Hit a wall, stop
                isMoving = false;
                playerDir = { x: 0, y: 0 };
            }
        }

        drawPlayer();
        renderTail();
    }
}

// ----------------------------------------------------
// Player Logic
// ----------------------------------------------------
function initPlayer() {
    // Find the home base to start
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (mapData[y][x] === TILE_TYPE.HOME) {
                player = { x: x, y: y };
                drawPlayer();
                return;
            }
        }
    }
}

function canMoveTo(tx, ty) {
    if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) return false;
    let targetType = mapData[ty][tx];
    let currentType = mapData[player.y][player.x];

    // Stop on normal buildings
    if (targetType === TILE_TYPE.BUILDING) return false;
    // Cannot re-enter home
    if (targetType === TILE_TYPE.HOME) return false;
    // Cannot enter a house without an active order
    if (targetType === TILE_TYPE.HOUSE && playerTail.length === 0) return false;

    // Strict constraint: Can only enter a warehouse/house from a ROAD.
    if (targetType === TILE_TYPE.WAREHOUSE || targetType === TILE_TYPE.HOUSE) {
        if (currentType !== TILE_TYPE.ROAD) {
            return false;
        }
    }

    return true;
}

function checkInteractions() {
    // Interaction is now triggered when ON the tile
    let tile = mapData[player.y][player.x];
    if (tile === TILE_TYPE.WAREHOUSE) {
        // Enforce pickup only if coming from the ROAD side
        let lastTile = (tailHistory.length > 0 && mapData[tailHistory[0].y]) ? mapData[tailHistory[0].y][tailHistory[0].x] : null;
        if (lastTile === TILE_TYPE.ROAD) {
            let w = warehouses.find(w => w.x === player.x && w.y === player.y);
            pickupOrder(w);
        }
    } else if (tile === TILE_TYPE.HOUSE) {
        // Enforce delivery only if coming from the ROAD side
        // Let's ensure the player's last valid road tile was adjacent
        if (tailHistory.length > 0) {
            let lastPos = tailHistory[0];
            let lastTile = mapData[lastPos.y] ? mapData[lastPos.y][lastPos.x] : null;
            if (lastTile === TILE_TYPE.ROAD) {
                deliverOrders();
            }
        }
    }
}

function renderTail() {
    tailGraphics.clear();
    let prevX = player.x * TILE_SIZE;
    let prevY = player.y * TILE_SIZE;

    for (let i = 0; i < playerTail.length; i++) {
        let box = playerTail[i];

        // 2 boxes fit into 1 grid tile of trailing distance
        let histIndex = Math.floor(i / 2) + 1;
        let pos = tailHistory[histIndex] || player;

        let gridX = pos.x * TILE_SIZE;
        let gridY = pos.y * TILE_SIZE;

        // Pull the box visually closer to the previous drawn box (bunching them up)
        // But ONLY if they haven't wrapped around the screen boundaries!
        let bx = gridX;
        let by = gridY;
        if (Math.abs(gridX - prevX) < TILE_SIZE * 3 && Math.abs(gridY - prevY) < TILE_SIZE * 3) {
            bx = prevX + (gridX - prevX) * 0.6;
            by = prevY + (gridY - prevY) * 0.6;
        }

        tailGraphics.fillStyle(box.type === 'yellow' ? COLORS.BOX_YELLOW : COLORS.BOX_RED, 1);
        // Make boxes slightly smaller to look better bunched
        let pad = TILE_SIZE * 0.25;
        tailGraphics.fillRoundedRect(bx + pad, by + pad, TILE_SIZE - (pad * 2), TILE_SIZE - (pad * 2), Math.max(1, Math.floor(TILE_SIZE * 0.075)));

        // draw rope only if segments are adjacent (not wrapped across screen)
        if (Math.abs(bx - prevX) <= TILE_SIZE * 2 && Math.abs(by - prevY) <= TILE_SIZE * 2) {
            tailGraphics.lineStyle(2, 0xffffff, 0.8);
            tailGraphics.moveTo(prevX + TILE_SIZE / 2, prevY + TILE_SIZE / 2);
            tailGraphics.lineTo(bx + TILE_SIZE / 2, by + TILE_SIZE / 2);
            tailGraphics.strokePath();
        }

        prevX = bx;
        prevY = by;
    }
}

function updateSpeed() {
    let redBoxes = playerTail.filter(b => b.type === 'red').length;
    // Increased penalty from 10% to 20% per red box to make it more noticeable
    speedMultiplier = Math.max(0.2, 1.0 - (redBoxes * 0.2));
}

function showFloatingText(htmlText, color, x, y) {
    if (!pcene) return;

    // Strip HTML spans and brs for Phaser text
    let cleanText = htmlText.replace(/<br>/gi, '\n').replace(/<[^>]+>/g, '');

    let px = x * TILE_SIZE + TILE_SIZE / 2;
    let py = y * TILE_SIZE;

    let textObj = pcene.add.text(px, py, cleanText, {
        fontFamily: 'Arial, sans-serif',
        fontSize: Math.floor(TILE_SIZE * 0.45) + 'px',
        color: color,
        stroke: '#000000',
        strokeThickness: Math.max(2, Math.floor(TILE_SIZE * 0.1)),
        align: 'center'
    }).setOrigin(0.5, 1).setDepth(100);

    pcene.tweens.add({
        targets: textObj,
        y: py - TILE_SIZE * 1.5,
        alpha: { from: 1, to: 0 },
        ease: 'Cubic.easeOut',
        duration: 1500,
        onComplete: () => textObj.destroy()
    });
}

function spawnConfetti(x, y) {
    if (!pcene) return;

    let px = x * TILE_SIZE + TILE_SIZE / 2;
    let py = y * TILE_SIZE + TILE_SIZE / 2;
    let colors = [0x00d166, 0x00aaff, 0xff4141, 0x8115ff, 0xffdd00];

    for (let i = 0; i < 20; i++) {
        let c = pcene.add.circle(px, py, 4, colors[Math.floor(Math.random() * colors.length)], 1).setDepth(200);

        let angle = Math.random() * Math.PI * 2;
        let radius = 40 + Math.random() * 60;
        let tx = px + Math.cos(angle) * radius;
        let ty = py + Math.sin(angle) * radius - 40;

        pcene.tweens.add({
            targets: c,
            x: tx,
            y: ty,
            alpha: { from: 1, to: 0 },
            ease: 'Cubic.easeOut',
            duration: 600,
            onComplete: () => c.destroy()
        });
    }
}

function showSpeechBubble(text, x, y) {
    if (!pcene) return;

    let px = x * TILE_SIZE + TILE_SIZE / 2;
    let py = y * TILE_SIZE;

    let textObj = pcene.add.text(px, py, text, {
        fontFamily: 'Arial, sans-serif',
        fontSize: Math.floor(TILE_SIZE * 0.35) + 'px',
        color: '#333333',
        backgroundColor: '#ffffff',
        padding: { x: 8, y: 8 },
        align: 'center'
    }).setOrigin(0.5, 1).setDepth(150);

    // Simple tween for bubble
    pcene.tweens.add({
        targets: textObj,
        y: py - TILE_SIZE * 1.5,
        alpha: { from: 1, to: 0 },
        ease: 'Cubic.easeOut',
        duration: 2500, // 20% slower fade
        onComplete: () => textObj.destroy()
    });
}

function pickupOrder(w) {
    if (playerTail.length >= 5) {
        // Show message if trying to pick up 6th box
        if (Date.now() - (window.lastWarningTime || 0) > 2000) { // 2s cooldown
            let bx = w ? w.x : player.x;
            let by = w ? w.y : player.y;
            showSpeechBubble("Извините, у вас\nбольше нет места!", bx, by);
            window.lastWarningTime = Date.now();
        }
        return;
    }

    let isUrgent = w ? (w.type === 'red') : (Phaser.Math.Between(0, 3) === 0);
    let box = {
        type: isUrgent ? 'red' : 'yellow',
        price: isUrgent ? 350 : 150
    };

    playerTail.push(box);
    updateSpeed();
    playSound('pickup');

    let bx = w ? w.x : player.x;
    let by = w ? w.y : player.y;
    if (playerTail.length < 5) {
        showSpeechBubble("Можно взять\nеще коробку", bx, by);
    } else {
        showSpeechBubble("Сумка заполнена!", bx, by);
    }

    // Reroll warehouse box type
    if (w) w.type = Phaser.Math.Between(0, 3) === 0 ? 'red' : 'yellow';

    // Add history padding if needed
    if (tailHistory.length < playerTail.length + 1) {
        tailHistory.push({ x: player.x, y: player.y });
    }

    // Dynamically spawn a house for this delivery
    spawnHouse();
}

function spawnHouse() {
    let attempts = 0;
    while (attempts < 100) {
        let bx = Phaser.Math.Between(0, Math.floor((MAP_WIDTH - 3) / 4)) * 4;
        let by = Phaser.Math.Between(0, Math.floor((MAP_HEIGHT - 3) / 4)) * 4;
        let hx = bx + Phaser.Math.Between(0, 2);
        let hy = by + (Phaser.Math.Between(0, 1) === 0 ? 0 : 2);

        if (mapData[hy] && mapData[hy][hx] === TILE_TYPE.BUILDING) {
            // Must be adjacent to road
            let dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
            let hasRoad = dirs.some(d => mapData[hy + d.y] && mapData[hy + d.y][hx + d.x] === TILE_TYPE.ROAD);
            if (hasRoad) {
                mapData[hy][hx] = TILE_TYPE.HOUSE;
                houses.push({ x: hx, y: hy });
                drawMap(); // redraw map to show new house
                return;
            }
        }
        attempts++;
    }
}

function deliverOrders() {
    if (playerTail.length === 0) return;

    // Delivery only one box (the oldest one) per house
    let box = playerTail.shift();

    // Formula: (Base Price) * (1 + (N-1) * 0.2), where N is totally carried boxes BEFORE delivery
    // Note: Since playerTail.shift() was already called, the current length is N - 1. 
    // Thus the formula boils down to: Base * (1 + playerTail.length * 0.2)
    let comboMultiplier = 1.0 + (playerTail.length * 0.2);
    let totalEarned = Math.floor(box.price * comboMultiplier);

    score += totalEarned;
    document.getElementById('score').innerText = score;
    // Removed flash class toggling as the forced reflow/offsetWidth causes Safari to jump

    let comboPercent = Math.round((comboMultiplier - 1.0) * 100);
    if (comboPercent > 0) {
        showFloatingText(`<span style="font-size:10px; color:#ffdd00;">Combo +${comboPercent}%</span><br>+${totalEarned} ₽`, '#00d166', player.x, player.y);
        spawnConfetti(player.x, player.y);
        playSound('coin'); // maybe play twice or slightly different for combo in future
    } else {
        showFloatingText(`+${totalEarned} ₽`, '#00d166', player.x, player.y);
        playSound('coin');
    }

    tailHistory.pop(); // remove oldest history coordinate
    updateSpeed();

    // Remove the house after successful delivery
    if (mapData[player.y][player.x] === TILE_TYPE.HOUSE) {
        mapData[player.y][player.x] = TILE_TYPE.BUILDING;
        houses = houses.filter(h => h.x !== player.x || h.y !== player.y);
        drawMap();
    }
}

function drawPlayer() {
    playerGraphics.clear();
    let px = player.x * TILE_SIZE;
    let py = player.y * TILE_SIZE;

    // Scale helpers
    let s1 = TILE_SIZE * 0.1;
    let s15 = TILE_SIZE * 0.15;
    let s2 = TILE_SIZE * 0.2;
    let s3 = TILE_SIZE * 0.3;
    let s4 = TILE_SIZE * 0.4;
    let s65 = TILE_SIZE * 0.65;
    let s7 = TILE_SIZE * 0.7;
    let s8 = TILE_SIZE * 0.8;
    let rSmall = TILE_SIZE * 0.05;
    let rMed = TILE_SIZE * 0.15;

    // Scooter body
    playerGraphics.fillStyle(0x0055ff, 1);
    if (playerDir.x !== 0) { // moving horizontally
        playerGraphics.fillRoundedRect(px + s1, py + s3, s8, s4, rMed);
        // wheels
        playerGraphics.fillStyle(0x222222, 1);
        playerGraphics.fillRoundedRect(px + s15, py + s2, s2, s1, rSmall);
        playerGraphics.fillRoundedRect(px + s65, py + s2, s2, s1, rSmall);
        playerGraphics.fillRoundedRect(px + s15, py + s7, s2, s1, rSmall);
        playerGraphics.fillRoundedRect(px + s65, py + s7, s2, s1, rSmall);
    } else { // moving vertically or stopped
        playerGraphics.fillRoundedRect(px + s3, py + s1, s4, s8, rMed);
        // wheels
        playerGraphics.fillStyle(0x222222, 1);
        playerGraphics.fillRoundedRect(px + s2, py + s15, s1, s2, rSmall);
        playerGraphics.fillRoundedRect(px + s7, py + s15, s1, s2, rSmall);
        playerGraphics.fillRoundedRect(px + s2, py + s65, s1, s2, rSmall);
        playerGraphics.fillRoundedRect(px + s7, py + s65, s1, s2, rSmall);
    }

    // Rider (Purple)
    // Blink if invulnerable
    if (invulnerableTimer <= 0 || Math.floor(invulnerableTimer / 100) % 2 === 0) {
        playerGraphics.fillStyle(COLORS.WAREHOUSE, 1); // purple
        playerGraphics.fillCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, s2); // head/helmet

        // Order box on back
        playerGraphics.fillStyle(0x555555, 1);
        let bW = TILE_SIZE * 0.25;
        let bH = TILE_SIZE * 0.3;

        if (playerDir.x > 0) playerGraphics.fillRect(px + s1, py + TILE_SIZE * 0.35, bW, bH); // left side
        else if (playerDir.x < 0) playerGraphics.fillRect(px + s65, py + TILE_SIZE * 0.35, bW, bH); // right side
        else if (playerDir.y > 0) playerGraphics.fillRect(px + TILE_SIZE * 0.35, py + s1, bH, bW); // top
        else if (playerDir.y <= 0) playerGraphics.fillRect(px + TILE_SIZE * 0.35, py + s65, bH, bW); // bottom
    }
}

function drawPulses() {
    pulseGraphics.clear();
    let alpha = (Math.sin(pulseTimer * 0.005) + 1) / 2; // 0 to 1

    let t2 = TILE_SIZE / 2;
    let t4 = TILE_SIZE / 4;
    let t34 = TILE_SIZE * 0.75;
    let tRad = TILE_SIZE * 0.45; // 18/40 = 0.45

    for (let w of warehouses) {
        let px = w.x * TILE_SIZE;
        let py = w.y * TILE_SIZE;
        let c = w.type === 'red' ? COLORS.BOX_RED : COLORS.BOX_YELLOW;

        // Draw bouncing arrow or pulse
        pulseGraphics.fillStyle(c, alpha);
        pulseGraphics.fillTriangle(px + t2, py - t4, px + t4, py - t2, px + t34, py - t2);

        // Aura around warehouse roof
        pulseGraphics.fillStyle(c, alpha * 0.4);
        pulseGraphics.fillCircle(px + t2, py + t2, tRad);
    }

    for (let h of houses) {
        let px = h.x * TILE_SIZE;
        let py = h.y * TILE_SIZE;

        // Blinking yellow aura
        pulseGraphics.fillStyle(COLORS.BOX_YELLOW, alpha * 0.4);
        pulseGraphics.fillCircle(px + t2, py + t2, tRad);

        // Main blinking house icon
        let houseAlpha = 0.5 + (alpha * 0.5); // pulse from 0.5 to 1.0 opacity
        pulseGraphics.fillStyle(COLORS.BOX_YELLOW, houseAlpha);
        pulseGraphics.fillRect(px + TILE_SIZE * 0.3, py + t2, TILE_SIZE * 0.4, TILE_SIZE * 0.3); // base
        pulseGraphics.fillTriangle(px + t2, py + TILE_SIZE * 0.2, px + TILE_SIZE * 0.2, py + t2, px + TILE_SIZE * 0.8, py + t2); // roof
    }
}

// ----------------------------------------------------
// Traffic Logic
// ----------------------------------------------------
function initCars() {
    cars = [];
    // Spawn cars on edges
    while (cars.length < CAR_SPAWN_COUNT) {
        spawnCar();
    }
}

function spawnCar() {
    let attempts = 0;
    while (attempts < 100) {
        attempts++;
        // Try to spawn on the edge of the map
        let x, y, dir;
        let edge = Phaser.Math.Between(0, 3); // 0: top, 1: right, 2: bottom, 3: left

        if (edge === 0) { x = Phaser.Math.Between(0, Math.floor(MAP_WIDTH / 4)) * 4 + 3; y = 0; dir = { x: 0, y: 1 }; }
        else if (edge === 1) { x = MAP_WIDTH - 1; y = Phaser.Math.Between(0, Math.floor(MAP_HEIGHT / 4)) * 4 + 3; dir = { x: -1, y: 0 }; }
        else if (edge === 2) { x = Phaser.Math.Between(0, Math.floor(MAP_WIDTH / 4)) * 4 + 3; y = MAP_HEIGHT - 1; dir = { x: 0, y: -1 }; }
        else { x = 0; y = Phaser.Math.Between(0, Math.floor(MAP_HEIGHT / 4)) * 4 + 3; dir = { x: 1, y: 0 }; }

        // Adjust bounds safety
        if (x >= MAP_WIDTH) x = MAP_WIDTH - 1;
        if (y >= MAP_HEIGHT) y = MAP_HEIGHT - 1;

        if (mapData[y][x] === TILE_TYPE.ROAD) {
            // Ensure not on top of player
            if (Math.abs(x - player.x) > 4 || Math.abs(y - player.y) > 4) {
                cars.push({
                    x: x,
                    y: y,
                    type: Phaser.Math.Between(0, 1) === 0 ? 'red' : 'blue',
                    dir: dir,
                    timer: 0
                });
                return;
            }
        }
    }
}

function updateCars(delta) {
    let moved = false;
    for (let car of cars) {
        car.timer += delta;
        if (car.timer >= CAR_SPEED_INTERVAL) {
            car.timer = 0;

            // Try to move forward
            let nextX = car.x + car.dir.x;
            let nextY = car.y + car.dir.y;

            if (mapData[nextY] && mapData[nextY][nextX] === TILE_TYPE.ROAD) {
                let blocked = cars.some(other => other !== car && other.x === nextX && other.y === nextY);
                if (blocked) {
                    car.blockedTicks = (car.blockedTicks || 0) + 1;
                    if (car.blockedTicks > 10) {
                        car.x = -1; // Despawn if stuck too long (deadlock resolution)
                        moved = true; // force redraw
                    } else {
                        car.timer = CAR_SPEED_INTERVAL - 50; // Try again very soon
                    }
                    continue; // Skip moving this frame
                }
                car.blockedTicks = 0;

                // Occasional random turn at intersections (where more than 2 road neighbors exist)
                let cellDirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
                let neighbors = cellDirs.filter(d => mapData[car.y + d.y] && mapData[car.y + d.y][car.x + d.x] === TILE_TYPE.ROAD);
                if (neighbors.length > 2 && Phaser.Math.Between(0, 2) === 0) { // 33% chance to turn at crossroad
                    let currentBackward = { x: -car.dir.x, y: -car.dir.y };
                    let turnOpts = neighbors.filter(d => d.x !== currentBackward.x || d.y !== currentBackward.y);
                    if (turnOpts.length > 0) {
                        car.dir = turnOpts[Phaser.Math.Between(0, turnOpts.length - 1)];
                    }
                }

                car.x += car.dir.x;
                car.y += car.dir.y;
                moved = true;
            } else {
                // Car hit a wall/edge. Instead of turning around, despawn it and replace.
                car.x = -1; // Flag for removal below
            }
        }

        // Check Collision with player AND player tail every frame
        // Safe Zone: If courier is in a house, warehouse or home, collisions don't count
        let crashed = false;
        let pTile = mapData[player.y] ? mapData[player.y][player.x] : null;
        if (invulnerableTimer <= 0 && pTile !== TILE_TYPE.HOUSE && pTile !== TILE_TYPE.WAREHOUSE && pTile !== TILE_TYPE.HOME && pTile !== TILE_TYPE.BUILDING) {
            // Also protect tail pieces if they are hovering over a safe house (e.g. while entering)
            if (car.x === player.x && car.y === player.y) crashed = true;
            for (let i = 0; i < playerTail.length; i++) {
                let histIndex = Math.floor(i / 2) + 1;
                let pos = tailHistory[histIndex] || player;
                if (car.x === pos.x && car.y === pos.y) {
                    let tileThere = mapData[pos.y] ? mapData[pos.y][pos.x] : null;
                    if (tileThere !== TILE_TYPE.HOUSE && tileThere !== TILE_TYPE.WAREHOUSE && tileThere !== TILE_TYPE.HOME && tileThere !== TILE_TYPE.BUILDING) {
                        crashed = true;
                    }
                }
            }
        }

        if (crashed) {
            handleCrash();
            break; // Stop updating other cars to prevent duplicate crashes
        }
    }

    // Filter out edge cars and spawn new ones to maintain COUNT
    let oldLen = cars.length;
    cars = cars.filter(c => c.x !== -1);
    if (cars.length !== oldLen) moved = true; // Redraw if cars despawned

    let toSpawn = CAR_SPAWN_COUNT - cars.length;
    for (let i = 0; i < toSpawn; i++) {
        spawnCar();
        moved = true; // Redraw when new cars arrive
    }

    if (moved) drawCars();
}

function drawCars() {
    entitiesGraphics.clear();
    for (let car of cars) {
        let cx = car.x * TILE_SIZE;
        let cy = car.y * TILE_SIZE;

        entitiesGraphics.fillStyle(car.type === 'red' ? COLORS.CAR_RED : COLORS.CAR_BLUE, 1);

        let s1 = TILE_SIZE * 0.1;
        let s2 = TILE_SIZE * 0.2;
        let s25 = TILE_SIZE * 0.25;
        let s5 = TILE_SIZE * 0.5;
        let s6 = TILE_SIZE * 0.6;
        let s75 = TILE_SIZE * 0.75;
        let s8 = TILE_SIZE * 0.8;
        let s9 = TILE_SIZE * 0.9;
        let s125 = TILE_SIZE * 1.25;
        let n25 = -TILE_SIZE * 0.25;

        // Car body
        if (car.dir.x !== 0) {
            entitiesGraphics.fillRoundedRect(cx + s1, cy + s2, s8, s6, s1);
            // Headlights
            entitiesGraphics.fillStyle(0xffffcc, 0.6);
            if (car.dir.x > 0) { // Right
                entitiesGraphics.fillTriangle(cx + s9, cy + s25, cx + s125, cy + s1, cx + s125, cy + s5);
                entitiesGraphics.fillTriangle(cx + s9, cy + s75, cx + s125, cy + s5, cx + s125, cy + s9);
            } else { // Left
                entitiesGraphics.fillTriangle(cx + s1, cy + s25, cx + n25, cy + s1, cx + n25, cy + s5);
                entitiesGraphics.fillTriangle(cx + s1, cy + s75, cx + n25, cy + s5, cx + n25, cy + s9);
            }
        } else {
            entitiesGraphics.fillRoundedRect(cx + s2, cy + s1, s6, s8, s1);
            // Headlights
            entitiesGraphics.fillStyle(0xffffcc, 0.6);
            if (car.dir.y > 0) { // Down
                entitiesGraphics.fillTriangle(cx + s25, cy + s9, cx + s1, cy + s125, cx + s5, cy + s125);
                entitiesGraphics.fillTriangle(cx + s75, cy + s9, cx + s5, cy + s125, cx + s9, cy + s125);
            } else { // Up
                entitiesGraphics.fillTriangle(cx + s25, cy + s1, cx + s1, cy + n25, cx + s5, cy + n25);
                entitiesGraphics.fillTriangle(cx + s75, cy + s1, cx + s5, cy + n25, cx + s9, cy + n25);
            }
        }
    }
}

function handleCrash() {
    playSound('crash');

    // Penalties
    gameTime -= 30; // -30 real seconds / in-game minutes
    if (gameTime < 0) gameTime = 0;
    updateGameTimeDisplay();

    showSpeechBubble("Вы потеряли 30 минут\nна оформление ДТП", player.x, player.y);
    showFloatingText("ТОВАР УТЕРЯН!", '#ff4141', player.x, player.y - 1);

    playerTail = [];
    tailHistory = [];
    updateSpeed();
    isMoving = false;
    playerDir = { x: 0, y: 0 };
    nextDir = { x: 0, y: 0 };
    invulnerableTimer = 2000;

    // Remove active houses
    for (let h of houses) {
        mapData[h.y][h.x] = TILE_TYPE.BUILDING;
    }
    houses = [];
    drawMap();

    // Player stays in place instead of respawning at the warehouse
    tailHistory.push({ x: player.x, y: player.y });
    drawPlayer();
    renderTail();
}

// ----------------------------------------------------
// Map Generation & Rendering
// ----------------------------------------------------
function generateMap(scene) {
    // 1. Initialize map with buildings
    for (let y = 0; y < MAP_HEIGHT; y++) {
        mapData[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            mapData[y][x] = TILE_TYPE.BUILDING;
        }
    }

    // 2. Carve roads (grid pattern)
    // Horizontal roads
    for (let y = 3; y < MAP_HEIGHT; y += 4) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            mapData[y][x] = TILE_TYPE.ROAD;
        }
    }
    // Vertical roads
    for (let x = 3; x < MAP_WIDTH; x += 4) {
        for (let y = 0; y < MAP_HEIGHT; y++) {
            mapData[y][x] = TILE_TYPE.ROAD;
        }
    }

    // 2.5 Place Player Home Base
    // Place at the bottom-right corner of the first top-left block, adjacent to roads
    mapData[2][2] = TILE_TYPE.HOME;

    // 3. Place Warehouses in completely random blocks
    let validBlocks = [];
    for (let by = 0; by < MAP_HEIGHT - 3; by += 4) {
        for (let bx = 0; bx < MAP_WIDTH - 3; bx += 4) {
            if (by === 0 && bx === 0) continue; // Skip home block
            validBlocks.push({ bx, by });
        }
    }

    // Shuffle the valid blocks using Phaser utility
    Phaser.Utils.Array.Shuffle(validBlocks);

    // Pick top 3 for warehouses
    let warehouseCount = Math.min(3, validBlocks.length);
    for (let i = 0; i < warehouseCount; i++) {
        let block = validBlocks[i];
        // Place Warehouse at the edge of the block so it touches the road
        let wx = block.bx + 1; // horizontally in middle
        let wy = block.by + (Phaser.Math.Between(0, 1) === 0 ? 0 : 2); // vertically on edge
        mapData[wy][wx] = TILE_TYPE.WAREHOUSE;
        let isUrgent = Phaser.Math.Between(0, 3) === 0;
        warehouses.push({ x: wx, y: wy, type: isUrgent ? 'red' : 'yellow' });
    }
}

function drawMap() {
    graphics.clear();

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            let tile = mapData[y][x];

            let px = x * TILE_SIZE;
            let py = y * TILE_SIZE;

            if (tile === TILE_TYPE.ROAD) {
                graphics.fillStyle(COLORS.ROAD, 1);
                graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                // Draw road dashed line
                graphics.lineStyle(2, 0x666666, 1);
                if (x % 2 === 0 && y % 4 === 3) { // horiz
                    graphics.moveTo(px, py + TILE_SIZE / 2);
                    graphics.lineTo(px + TILE_SIZE, py + TILE_SIZE / 2);
                    graphics.strokePath();
                } else if (y % 2 === 0 && x % 4 === 3) { // vert
                    graphics.moveTo(px + TILE_SIZE / 2, py);
                    graphics.lineTo(px + TILE_SIZE / 2, py + TILE_SIZE);
                    graphics.strokePath();
                }
            }
            else if (tile === TILE_TYPE.BUILDING) {
                // Draw green park area
                graphics.fillStyle(COLORS.HOUSE_ZONE, 1);
                graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                // slight border darker green
                graphics.lineStyle(1, 0x009944, 1);
                graphics.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

                // Deterministic Tree Generation
                let seed = x * 73 + y * 31;
                if (seed % 3 === 0) {
                    let tRad = TILE_SIZE * 0.25;
                    let tOff = Math.max(1, Math.floor(TILE_SIZE * 0.05));
                    graphics.fillStyle(0x005522, 1); // Dark shadow
                    graphics.fillCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2 + tOff, tRad);
                    graphics.fillStyle(0x008833, 1); // Tree top
                    graphics.fillCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2 - tOff, tRad);
                }
            }
            else if (tile === TILE_TYPE.WAREHOUSE) {
                graphics.fillStyle(COLORS.WAREHOUSE, 1);
                graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                // White Roof
                graphics.fillStyle(0xffffff, 1);
                let p = Math.floor(TILE_SIZE * 0.1);
                graphics.fillRoundedRect(px + p, py + p, TILE_SIZE - (p * 2), TILE_SIZE - (p * 2), p);

                // Draw Avito logo (SVG 40x40 scaled to 24x24)
                let ox = px + TILE_SIZE * 0.2;
                let oy = py + TILE_SIZE * 0.2;
                let s = (TILE_SIZE / 40) * 0.6; // Scale down the base 40px matrix drawing
                graphics.fillStyle(0x00d166, 1); graphics.fillCircle(ox + 14 * s, oy + 26 * s, 14 * s);
                graphics.fillStyle(0x00aaff, 1); graphics.fillCircle(ox + 30 * s, oy + 11 * s, 10 * s);
                graphics.fillStyle(0xff4141, 1); graphics.fillCircle(ox + 32 * s, oy + 30 * s, 8 * s);
                graphics.fillStyle(0x8115ff, 1); graphics.fillCircle(ox + 12 * s, oy + 7 * s, 5 * s);
            }
            else if (tile === TILE_TYPE.HOUSE) {
                // Draw green park area under house (trees are replaced)
                graphics.fillStyle(COLORS.HOUSE_ZONE, 1);
                graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                // slight border darker green
                graphics.lineStyle(1, 0x009944, 1);
                graphics.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

                // The actual animated House Icon is drawn in drawPulses() frame loop
            }
            // Draw random trees on plain buildings
            else if (tile === TILE_TYPE.BUILDING) {
                graphics.fillStyle(COLORS.BUILDING, 1);
                graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                graphics.lineStyle(1, 0xcccccc, 1);
                graphics.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
                // Tree scatter (pseudo random based on position)
                let seed = x * 100 + y;
                if (seed % 3 === 0) {
                    graphics.fillStyle(0x2d6a4f, 1); // Dark Green
                    graphics.fillCircle(px + 10, py + 10, 8);
                    graphics.fillCircle(px + 30, py + 25, 12);
                    graphics.fillCircle(px + 20, py + 15, 10);
                }
            }
            else if (tile === TILE_TYPE.HOME) {
                // Purple base background
                graphics.fillStyle(COLORS.WAREHOUSE, 1);
                graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                // Roof
                graphics.fillStyle(0x5e0fbd, 1); // Darker purple
                graphics.fillTriangle(px, py + TILE_SIZE / 2, px + TILE_SIZE / 2, py, px + TILE_SIZE, py + TILE_SIZE / 2);
                graphics.fillRect(px + 4, py + TILE_SIZE / 2, TILE_SIZE - 8, TILE_SIZE / 2);
                // Door
                graphics.fillStyle(0xdddddd, 1);
                graphics.fillRect(px + TILE_SIZE / 2 - 6, py + TILE_SIZE - 12, 12, 12);
            }
        }
    }
}

// ----------------------------------------------------
// UI Logic
// ----------------------------------------------------
function updateGameTime() {
    if (gamePaused) return;
    gameTime--;
    updateGameTimeDisplay();
}

function updateGameTimeDisplay() {
    if (gameTime <= GAME_END_TIME) {
        // Game Over Logic
        if (timeTextTimer) timeTextTimer.remove();
        isMoving = false;

        let overlay = document.createElement('div');
        overlay.id = 'game-over';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '1000';

        overlay.innerHTML = `
            <h1 style="color: #00d166; font-size: clamp(32px, 8vw, 48px); margin-bottom: 20px; text-align: center; text-shadow: 0 4px 6px rgba(0,0,0,0.5);">СМЕНА ОКОНЧЕНА</h1>
            <p style="font-size: clamp(18px, 5vw, 24px); color: white; text-align: center; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">Заработано: <strong>${score} ₽</strong></p>
            <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 30px; align-items: center; width: 100%; padding: 0 20px; box-sizing: border-box;">
                <button onclick="location.reload()" class="btn-primary" style="background-color: #8115ff; width: 100%; max-width: 300px; padding: 15px;">Сыграть ещё</button>
                <button onclick="window.open('https://www.avito.ru/all/vakansii', '_blank')" class="btn-primary" style="width: 100%; max-width: 300px; padding: 15px;">Найти настоящую работу</button>
            </div>
        `;
        document.getElementById('ui-container').appendChild(overlay);

        return;
    }

    let hours = Math.floor(gameTime / 60);
    let mins = gameTime % 60;

    let hoursStr = hours < 10 ? '0' + hours : hours;
    let minsStr = mins < 10 ? '0' + mins : mins;

    let timeEl = document.getElementById('time');
    if (timeEl) timeEl.innerText = hoursStr + ':' + minsStr;

    // Update progress bar
    let progressEl = document.getElementById('time-progress');
    if (progressEl) {
        let totalMins = 480; // from 8 hours down to 0
        let p = (gameTime / totalMins) * 100;
        // p goes from 100% to 0%
        progressEl.style.width = Math.min(100, Math.max(0, p)) + '%';
    }
}

// ----------------------------------------------------
// Audio Synthesizer Helpers
// ----------------------------------------------------
function playSound(type) {
    if (!audioCtx || audioCtx.state === 'suspended') return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'coin' || type === 'pickup' || type === 'crash') {
        osc.type = type === 'coin' ? 'sine' : (type === 'crash' ? 'sawtooth' : 'triangle');
        let f1 = type === 'coin' ? 880 : (type === 'crash' ? 100 : 440);
        let f2 = type === 'coin' ? 1760 : (type === 'crash' ? 40 : 880);
        let t = type === 'coin' ? 0.3 : (type === 'crash' ? 0.5 : 0.15);

        osc.frequency.setValueAtTime(f1, audioCtx.currentTime); // A5
        osc.frequency.exponentialRampToValueAtTime(f2, audioCtx.currentTime + 0.1); // A6

        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + t);

        osc.start();
        osc.stop(audioCtx.currentTime + t);
    }
}
