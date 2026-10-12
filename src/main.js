import { FootballEngine } from './engine/Engine.js';
import { DemoSim } from './demo/DemoSim.js';

const params = new URLSearchParams(location.search);
const engine = new FootballEngine(document.getElementById('app'), {
  preserveDrawingBuffer: params.has('capture'),
  playerModel: params.has('classic') ? 'classic' : 'meshy',   // ?classic = the previous players (fallback)
});
// The demo driver. Swap this for your coach/sim layer.
const sim = params.has('nosim') ? null : new DemoSim(engine);

window.engine = engine; // handy for console poking
window.sim = sim;

addEventListener('keydown', (ev) => {
  const modes = { Digit1: 'broadcast', Digit2: 'high', Digit3: 'endzone', Digit4: 'field' };
  if (modes[ev.code]) engine.cam.setMode(modes[ev.code]);
  if (ev.code === 'Space') engine.paused = !engine.paused;
  if (ev.code === 'BracketLeft') engine.timeScale = Math.max(0.1, engine.timeScale * 0.5);
  if (ev.code === 'BracketRight') engine.timeScale = Math.min(2, engine.timeScale * 2);
});
