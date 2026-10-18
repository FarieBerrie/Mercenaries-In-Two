// Keyboard, mouse and gamepad, turned into the actions the game asks about (down, pressed, look,
// moveVector). "pressed" is true for the first game step after a press, however many steps run
// in a frame. Mouse movement piles up between steps; peekLook() lets the camera show it right
// away so turning stays smooth on fast displays.

/** Default keys per action (KeyboardEvent.code, or Mouse0..Mouse2, WheelUp, WheelDown). */
export const BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  vault: ['Space'],
  reload: ['KeyR'],
  use: ['KeyE'],
  grenade: ['KeyG'],
  swap: ['KeyQ', 'WheelUp', 'WheelDown'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  orderAdvance: ['KeyZ'],
  orderRegroup: ['KeyX'],
  orderHold: ['KeyV'],
  pause: ['Escape', 'KeyP'],
};

/** Labels for the keys, for on-screen prompts. */
export function keyLabel(action) {
  const code = BINDINGS[action]?.[0] ?? '';
  return (
    { Mouse0: 'LMB', Mouse2: 'RMB', ShiftLeft: 'SHIFT', Space: 'SPACE', Escape: 'ESC', WheelUp: 'WHEEL' }[code] ||
    code.replace(/^Key|^Digit|^Arrow/, '')
  );
}

// Standard gamepad layout: buttons by index
const PAD = {
  use: [0], // A
  crouch: [1], // B
  reload: [2], // X
  swap: [3], // Y
  grenade: [4], // LB
  vault: [5], // RB
  aim: [6], // LT
  fire: [7], // RT
  pause: [9], // Start
  sprint: [10], // L3
  orderAdvance: [12], // d-pad up
  orderHold: [13], // d-pad down
  orderRegroup: [14, 15], // d-pad left / right
};

const DEAD = 0.18;
const deadzone = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)));

export function createInput(target, settings) {
  const held = new Set(); // codes
  const pressedCodes = new Set(); // since the last game step
  const padHeld = new Set(); // actions held on the gamepad
  const padPressed = new Set();
  const listeners = new Set();
  let lookX = 0;
  let lookY = 0;
  let padMove = { x: 0, y: 0 };
  let lastDevice = 'keyboard';
  let enabled = true;

  const codeDown = (code) => {
    if (!held.has(code)) pressedCodes.add(code);
    held.add(code);
    lastDevice = 'keyboard';
    for (const [action, codes] of Object.entries(BINDINGS)) if (codes.includes(code)) for (const fn of listeners) fn(action, code);
  };
  const codeUp = (code) => held.delete(code);

  const isLocked = () => document.pointerLockElement === target;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    // Keep the browser's own shortcuts (tab switching, devtools) but not the ones that fight the game
    if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'ControlLeft'].includes(e.code) || (isLocked() && !e.metaKey)) e.preventDefault();
    codeDown(e.code);
  });
  window.addEventListener('keyup', (e) => codeUp(e.code));
  window.addEventListener('blur', () => held.clear());
  target.addEventListener('mousedown', (e) => {
    if (!isLocked()) return;
    codeDown(`Mouse${e.button}`);
  });
  window.addEventListener('mouseup', (e) => codeUp(`Mouse${e.button}`));
  target.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (!isLocked() || !enabled) return;
    const k = 0.0022 * settings.sensitivity * (input.zoomed ? settings.aimSensitivity : 1);
    lookX += e.movementX * k;
    lookY += e.movementY * k * (settings.invertY ? -1 : 1);
  });
  target.addEventListener(
    'wheel',
    (e) => {
      if (!isLocked()) return;
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      pressedCodes.add(code);
    },
    { passive: true },
  );

  const actionDown = (a) => (BINDINGS[a] || []).some((c) => held.has(c)) || padHeld.has(a);
  const actionPressed = (a) => (BINDINGS[a] || []).some((c) => pressedCodes.has(c)) || padPressed.has(a);

  let prevPad = new Set();
  const input = {
    zoomed: false,
    get device() {
      return lastDevice;
    },
    get locked() {
      return isLocked();
    },
    lock() {
      if (!isLocked()) target.requestPointerLock?.()?.catch?.(() => {});
    },
    unlock() {
      if (isLocked()) document.exitPointerLock();
    },
    setEnabled(on) {
      enabled = on;
      if (!on) {
        lookX = lookY = 0;
      }
    },
    /** Called for every key or button press, for menus. fn(action, code) */
    onAction(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    down: (a) => enabled && actionDown(a),
    pressed: (a) => enabled && actionPressed(a),
    look() {
      const l = { x: lookX, y: lookY };
      lookX = lookY = 0;
      return l;
    },
    /** Turning that hasn't reached the game yet, for the camera. */
    peekLook: () => ({ x: lookX, y: lookY }),
    moveVector(aimYaw) {
      if (!enabled) return { x: 0, z: 0 };
      let fwd = (actionDown('up') ? 1 : 0) - (actionDown('down') ? 1 : 0);
      let right = (actionDown('right') ? 1 : 0) - (actionDown('left') ? 1 : 0);
      if (Math.hypot(padMove.x, padMove.y) > 0.05) {
        fwd = -padMove.y;
        right = padMove.x;
      }
      const len = Math.hypot(fwd, right);
      if (len > 1) {
        fwd /= len;
        right /= len;
      }
      const f = { x: Math.cos(aimYaw), z: Math.sin(aimYaw) };
      const r = { x: -Math.sin(aimYaw), z: Math.cos(aimYaw) };
      return { x: f.x * fwd + r.x * right, z: f.z * fwd + r.z * right };
    },
    /** After each game step: presses have been seen. */
    endStep() {
      pressedCodes.clear();
      padPressed.clear();
    },

    /** Once a frame: reads the gamepad (sticks turn the view at a rate, so they need dt). */
    poll(dt) {
      const pad = [...(navigator.getGamepads?.() || [])].find((p) => p && p.connected && p.mapping === 'standard');
      padHeld.clear();
      padMove = { x: 0, y: 0 };
      if (!pad) return;
      const now = new Set();
      for (const [action, idx] of Object.entries(PAD)) {
        if (idx.some((i) => pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.4)) now.add(action);
      }
      for (const a of now) {
        padHeld.add(a);
        if (!prevPad.has(a)) {
          padPressed.add(a);
          lastDevice = 'gamepad';
          for (const fn of listeners) fn(a, 'pad');
        }
      }
      prevPad = now;
      padMove = { x: deadzone(pad.axes[0] || 0), y: deadzone(pad.axes[1] || 0) };
      const rx = deadzone(pad.axes[2] || 0);
      const ry = deadzone(pad.axes[3] || 0);
      if (rx || ry || padMove.x || padMove.y) lastDevice = 'gamepad';
      if (enabled) {
        // Response curve: fine control near the centre, quick turns at full tilt
        const rate = 3.2 * settings.sensitivity * (input.zoomed ? settings.aimSensitivity * 0.8 : 1);
        lookX += Math.sign(rx) * rx * rx * rate * dt;
        lookY += Math.sign(ry) * ry * ry * rate * 0.7 * dt * (settings.invertY ? -1 : 1);
      }
    },
  };
  return input;
}
