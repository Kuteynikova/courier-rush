// Game Configuration
const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 600,   // 15 tiles
        height: 1080  // 27 tiles (Portrait 9:16 approx)
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

// Constants
const TILE_SIZE = 40;
const MAP_WIDTH = 15;
const MAP_HEIGHT = 27;
const BLOCKS_PER_WAREHOUSE = 5;

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
const CAR_SPEED_INTERVAL = 250; // Same speed as player (250ms per tile)

let player;
let playerDir = { x: 0, y: 0 };
let nextDir = { x: 0, y: 0 };
let isMoving = false;
let moveTimer = 0;
const MOVE_INTERVAL = 250; // ms per tile, slower for better control
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
    this.cameras.main.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    // Setup start button and pause logic
    document.getElementById('btn-start').addEventListener('click', () => {
        document.getElementById('start-screen').style.display = 'none';
        gamePaused = false;
        if (audioCtx.state === 'suspended') audioCtx.resume();
    });

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
    this.input.keyboard.on('keydown-UP', () => nextDir = { x: 0, y: -1 });
    this.input.keyboard.on('keydown-DOWN', () => nextDir = { x: 0, y: 1 });
    this.input.keyboard.on('keydown-LEFT', () => nextDir = { x: -1, y: 0 });
    this.input.keyboard.on('keydown-RIGHT', () => nextDir = { x: 1, y: 0 });

    // Swipe handling
    this.input.on('pointerup', (pointer) => {
        let dx = pointer.upX - pointer.downX;
        let dy = pointer.upY - pointer.downY;
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 30) nextDir = { x: 1, y: 0 };
            else if (dx < -30) nextDir = { x: -1, y: 0 };
        } else {
            if (dy > 30) nextDir = { x: 0, y: 1 };
            else if (dy < -30) nextDir = { x: 0, y: -1 };
        }
    });
}

function update(time, delta) {
    if (gameTime <= GAME_END_TIME || gamePaused) return;

    // Follow player with camera
    if (pcene && player) {
        let cam = pcene.cameras.main;
        cam.scrollX = (player.x * TILE_SIZE + TILE_SIZE / 2) - cam.width / 2;
        cam.scrollY = (player.y * TILE_SIZE + TILE_SIZE / 2) - cam.height / 2;
    }

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
        if ((nextDir.x !== 0 || nextDir.y !== 0) && canMoveTo(player.x + nextDir.x, player.y + nextDir.y)) {
            playerDir = { x: nextDir.x, y: nextDir.y };
            nextDir = { x: 0, y: 0 };
            isMoving = true;
        }

        // Move forward if moving
        if (isMoving) {
            if (canMoveTo(player.x + playerDir.x, player.y + playerDir.y)) {
                // Save history before moving
                tailHistory.unshift({ x: player.x, y: player.y });
                if (tailHistory.length > playerTail.length + 1) {
                    tailHistory.pop();
                }

                player.x += playerDir.x;
                player.y += playerDir.y;

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
    let t = mapData[ty][tx];
    // Stop on normal buildings
    if (t === TILE_TYPE.BUILDING) return false;
    // Cannot re-enter home
    if (t === TILE_TYPE.HOME) return false;
    // Cannot enter a house without an active order
    if (t === TILE_TYPE.HOUSE && playerTail.length === 0) return false;
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
        let bx = prevX + (gridX - prevX) * 0.6;
        let by = prevY + (gridY - prevY) * 0.6;

        tailGraphics.fillStyle(box.type === 'yellow' ? COLORS.BOX_YELLOW : COLORS.BOX_RED, 1);
        // Make boxes slightly smaller to look better bunched
        tailGraphics.fillRoundedRect(bx + 10, by + 10, TILE_SIZE - 20, TILE_SIZE - 20, 3);

        // draw rope
        tailGraphics.lineStyle(2, 0xffffff, 0.8);
        tailGraphics.moveTo(prevX + TILE_SIZE / 2, prevY + TILE_SIZE / 2);
        tailGraphics.lineTo(bx + TILE_SIZE / 2, by + TILE_SIZE / 2);
        tailGraphics.strokePath();

        prevX = bx;
        prevY = by;
    }
}

function updateSpeed() {
    let redBoxes = playerTail.filter(b => b.type === 'red').length;
    speedMultiplier = Math.max(0.1, 1.0 - (redBoxes * 0.1));
}

function createFloatingElement(x, y, offsetY, childDiv) {
    let wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';

    let canvas = document.querySelector('canvas');
    if (canvas) {
        let rect = canvas.getBoundingClientRect();
        let container = document.getElementById('ui-container').getBoundingClientRect();
        let scale = rect.width / (MAP_WIDTH * TILE_SIZE); // Map logic width is 600
        let left = (rect.left - container.left) + (x * TILE_SIZE + TILE_SIZE / 2) * scale;
        let top = (rect.top - container.top) + (y * TILE_SIZE + offsetY) * scale;

        wrapper.style.left = `${left}px`;
        wrapper.style.top = `${top}px`;
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.zIndex = 100;
    }

    wrapper.appendChild(childDiv);
    document.getElementById('ui-container').appendChild(wrapper);
    return wrapper;
}

function showFloatingText(text, color, x, y) {
    let t = document.createElement('div');
    t.innerText = text;
    t.style.position = 'absolute';
    t.style.left = '0';
    t.style.top = '0';
    t.style.color = color;
    t.style.fontWeight = 'bold';
    t.style.textShadow = '1px 1px 2px black';
    t.style.pointerEvents = 'none';
    t.style.animation = 'floatUp 1s ease-out forwards';
    t.style.whiteSpace = 'nowrap';

    let wrapper = createFloatingElement(x, y, 0, t);

    setTimeout(() => {
        wrapper.remove();
    }, 1000);
}

// Add CSS for floating text animation dynamically
if (!document.getElementById('float-anim')) {
    let style = document.createElement('style');
    style.id = 'float-anim';
    style.innerHTML = `
        @keyframes floatUp {
            0% { transform: translate(-50%, -10px); opacity: 1; }
            100% { transform: translate(-50%, -40px); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

function showSpeechBubble(text, x, y) {
    let t = document.createElement('div');
    t.innerText = text;
    t.style.position = 'absolute';
    t.style.left = '0';
    t.style.top = '0';
    t.style.backgroundColor = 'white';
    t.style.color = '#333';
    t.style.padding = '8px 12px';
    t.style.borderRadius = '16px';
    t.style.border = '2px solid #ccc';
    t.style.fontSize = '12px';
    t.style.fontWeight = 'bold';
    t.style.textAlign = 'center';
    t.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
    t.style.pointerEvents = 'none';
    t.style.whiteSpace = 'nowrap';

    // The little triangle pointing down
    let ptr = document.createElement('div');
    ptr.style.position = 'absolute';
    ptr.style.bottom = '-6px';
    ptr.style.left = '50%';
    ptr.style.transform = 'translateX(-50%) rotate(45deg)';
    ptr.style.width = '10px';
    ptr.style.height = '10px';
    ptr.style.backgroundColor = 'white';
    ptr.style.borderRight = '2px solid #ccc';
    ptr.style.borderBottom = '2px solid #ccc';
    t.appendChild(ptr);

    // Animation applies to the inner element
    t.style.animation = 'bubbleUp 2s ease-out forwards';

    let wrapper = createFloatingElement(x, y, -20, t);

    setTimeout(() => {
        wrapper.remove();
    }, 2000);
}

if (!document.getElementById('bubble-anim')) {
    let style = document.createElement('style');
    style.id = 'bubble-anim';
    style.innerHTML = `
        @keyframes bubbleUp {
            0% { transform: translate(-50%, 10px) scale(0.5); opacity: 0; }
            10% { transform: translate(-50%, 0) scale(1.1); opacity: 1; }
            20% { transform: translate(-50%, 0) scale(1); opacity: 1; }
            80% { transform: translate(-50%, 0) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -10px) scale(0.9); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
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
    let totalEarned = box.price;

    score += totalEarned;
    document.getElementById('score').innerText = score;
    document.getElementById('score').parentElement.classList.remove('flash');
    void document.getElementById('score').parentElement.offsetWidth; // trigger reflow
    document.getElementById('score').parentElement.classList.add('flash');

    showFloatingText(`+${totalEarned} ₽`, '#00d166', player.x, player.y);

    tailHistory.pop(); // remove oldest history coordinate
    updateSpeed();
    playSound('coin');

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

    // Draw scooter and rider (purple uniform, blue scooter)
    // Scooter body
    playerGraphics.fillStyle(0x0055ff, 1);
    if (playerDir.x !== 0) { // moving horizontally
        playerGraphics.fillRoundedRect(px + 4, py + 12, 32, 16, 6);
        // wheels
        playerGraphics.fillStyle(0x222222, 1);
        playerGraphics.fillRoundedRect(px + 6, py + 8, 8, 4, 2);
        playerGraphics.fillRoundedRect(px + 26, py + 8, 8, 4, 2);
        playerGraphics.fillRoundedRect(px + 6, py + 28, 8, 4, 2);
        playerGraphics.fillRoundedRect(px + 26, py + 28, 8, 4, 2);
    } else { // moving vertically or stopped
        playerGraphics.fillRoundedRect(px + 12, py + 4, 16, 32, 6);
        // wheels
        playerGraphics.fillStyle(0x222222, 1);
        playerGraphics.fillRoundedRect(px + 8, py + 6, 4, 8, 2);
        playerGraphics.fillRoundedRect(px + 28, py + 6, 4, 8, 2);
        playerGraphics.fillRoundedRect(px + 8, py + 26, 4, 8, 2);
        playerGraphics.fillRoundedRect(px + 28, py + 26, 4, 8, 2);
    }

    // Rider (Purple)
    // Blink if invulnerable
    if (invulnerableTimer <= 0 || Math.floor(invulnerableTimer / 100) % 2 === 0) {
        playerGraphics.fillStyle(COLORS.WAREHOUSE, 1); // purple
        playerGraphics.fillCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 8); // head/helmet

        // Order box on back
        playerGraphics.fillStyle(0x555555, 1);
        if (playerDir.x > 0) playerGraphics.fillRect(px + 4, py + 14, 10, 12); // left side
        else if (playerDir.x < 0) playerGraphics.fillRect(px + 26, py + 14, 10, 12); // right side
        else if (playerDir.y > 0) playerGraphics.fillRect(px + 14, py + 4, 12, 10); // top
        else if (playerDir.y <= 0) playerGraphics.fillRect(px + 14, py + 26, 12, 10); // bottom
    }
}

function drawPulses() {
    pulseGraphics.clear();
    let alpha = (Math.sin(pulseTimer * 0.005) + 1) / 2; // 0 to 1

    for (let w of warehouses) {
        let px = w.x * TILE_SIZE;
        let py = w.y * TILE_SIZE;
        let c = w.type === 'red' ? COLORS.BOX_RED : COLORS.BOX_YELLOW;

        // Draw bouncing arrow or pulse
        pulseGraphics.fillStyle(c, alpha);
        pulseGraphics.fillTriangle(px + 20, py - 10, px + 10, py - 20, px + 30, py - 20);

        // Aura around warehouse roof
        pulseGraphics.fillStyle(c, alpha * 0.4);
        pulseGraphics.fillCircle(px + 20, py + 20, 18);
    }

    for (let h of houses) {
        let px = h.x * TILE_SIZE;
        let py = h.y * TILE_SIZE;

        // Blinking yellow aura
        pulseGraphics.fillStyle(COLORS.BOX_YELLOW, alpha * 0.4);
        pulseGraphics.fillCircle(px + 20, py + 20, 18);

        // Main blinking house icon
        let houseAlpha = 0.5 + (alpha * 0.5); // pulse from 0.5 to 1.0 opacity
        pulseGraphics.fillStyle(COLORS.BOX_YELLOW, houseAlpha);
        pulseGraphics.fillRect(px + 12, py + 20, 16, 12); // base
        pulseGraphics.fillTriangle(px + 20, py + 8, px + 8, py + 20, px + 32, py + 20); // roof
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

        // Car body
        if (car.dir.x !== 0) {
            entitiesGraphics.fillRoundedRect(cx + 4, cy + 8, 32, 24, 4);
            // Headlights
            entitiesGraphics.fillStyle(0xffffcc, 0.6);
            if (car.dir.x > 0) { // Right
                entitiesGraphics.fillTriangle(cx + 36, cy + 10, cx + 50, cy + 4, cx + 50, cy + 20);
                entitiesGraphics.fillTriangle(cx + 36, cy + 30, cx + 50, cy + 20, cx + 50, cy + 36);
            } else { // Left
                entitiesGraphics.fillTriangle(cx + 4, cy + 10, cx - 10, cy + 4, cx - 10, cy + 20);
                entitiesGraphics.fillTriangle(cx + 4, cy + 30, cx - 10, cy + 20, cx - 10, cy + 36);
            }
        } else {
            entitiesGraphics.fillRoundedRect(cx + 8, cy + 4, 24, 32, 4);
            // Headlights
            entitiesGraphics.fillStyle(0xffffcc, 0.6);
            if (car.dir.y > 0) { // Down
                entitiesGraphics.fillTriangle(cx + 10, cy + 36, cx + 4, cy + 50, cx + 20, cy + 50);
                entitiesGraphics.fillTriangle(cx + 30, cy + 36, cx + 20, cy + 50, cx + 36, cy + 50);
            } else { // Up
                entitiesGraphics.fillTriangle(cx + 10, cy + 4, cx + 4, cy - 10, cx + 20, cy - 10);
                entitiesGraphics.fillTriangle(cx + 30, cy + 4, cx + 20, cy - 10, cx + 36, cy - 10);
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

    // 3. Place Warehouses in blocks (Houses spawn dynamically later)
    let blockCount = 0;
    for (let by = 0; by < MAP_HEIGHT - 3; by += 4) {
        for (let bx = 0; bx < MAP_WIDTH - 3; bx += 4) {
            blockCount++;

            if (by === 0 && bx === 0) continue; // Skip home block

            // Generate Warehouse every 4-6 blocks (approx)
            if (blockCount % BLOCKS_PER_WAREHOUSE === 0) {
                // Place Warehouse at the edge of the block so it touches the road
                let wx = bx + 1; // horizontally in middle
                let wy = by + (Phaser.Math.Between(0, 1) === 0 ? 0 : 2); // vertically on edge
                mapData[wy][wx] = TILE_TYPE.WAREHOUSE;
                let isUrgent = Phaser.Math.Between(0, 3) === 0;
                warehouses.push({ x: wx, y: wy, type: isUrgent ? 'red' : 'yellow' });
            }
        }
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
                    graphics.fillStyle(0x005522, 1); // Dark shadow
                    graphics.fillCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2 + 2, 10);
                    graphics.fillStyle(0x008833, 1); // Tree top
                    graphics.fillCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2 - 2, 10);
                }
            }
            else if (tile === TILE_TYPE.WAREHOUSE) {
                graphics.fillStyle(COLORS.WAREHOUSE, 1);
                graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                // White Roof
                graphics.fillStyle(0xffffff, 1);
                graphics.fillRoundedRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 4);

                // Draw Avito logo (SVG 40x40 scaled to 24x24)
                let ox = px + 8;
                let oy = py + 8;
                let s = 0.6;
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
            <h1 style="color: #00d166; font-size: 48px; margin-bottom: 20px;">СМЕНА ОКОНЧЕНА</h1>
            <p style="font-size: 24px; color: white;">Заработано: <strong>${score} ₽</strong></p>
            <button onclick="location.reload()" style="margin-top: 30px; padding: 15px 30px; font-size: 20px; background-color: #8115ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">Начать заново</button>
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
