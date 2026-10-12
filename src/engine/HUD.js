import { WOLF_OUTLINE, WOLF_DETAIL } from './Field.js';

function wolfSVG(c, mirror) {
  const pts = (arr) => arr.map(([x, y]) => `${mirror ? 200 - x : x},${y}`).join(' ');
  return `<svg viewBox="-10 -10 220 150" class="logo">
    <polygon points="${pts(WOLF_OUTLINE)}" fill="${c.outline}" stroke="${c.outline}" stroke-width="12" stroke-linejoin="round"/>
    <polygon points="${pts(WOLF_OUTLINE)}" fill="${c.base}"/>
    <polygon points="${pts(WOLF_DETAIL.cheek)}" fill="${c.shade}"/>
    <polygon points="${pts(WOLF_DETAIL.highlight)}" fill="${c.light}"/>
    <polygon points="${pts(WOLF_DETAIL.earL)}" fill="${c.outline}"/>
    <polygon points="${pts(WOLF_DETAIL.earR)}" fill="${c.outline}"/>
    <polygon points="${pts(WOLF_DETAIL.mouth)}" fill="${c.outline}"/>
    <polygon points="${pts(WOLF_DETAIL.eye)}" fill="${c.eye}"/>
  </svg>`;
}

const CSS = `
.gr-hud{position:absolute;left:0;top:0;width:100%;pointer-events:none;font-family:'Oswald','Arial Narrow','Roboto Condensed',sans-serif;user-select:none}
.gr-bug{position:absolute;left:8.4%;right:2%;top:4.2vh;height:clamp(40px,8vh,78px);display:flex;align-items:stretch;
  box-shadow:0 4px 14px rgba(0,0,0,.35);border-radius:3px;overflow:hidden;color:#fff;font-weight:600;letter-spacing:.02em}
.gr-bug>div{display:flex;align-items:center;justify-content:center}
.gr-team{position:relative;gap:.7em;padding:0 1.1em 0 1.3em;font-size:clamp(14px,2.6vh,28px);text-transform:uppercase}
.gr-team .logo{height:120%;width:auto;margin-top:-2%;filter:drop-shadow(0 2px 1px rgba(0,0,0,.35))}
.gr-team .name{display:flex;flex-direction:column;line-height:1}
.gr-team .tos{display:flex;gap:4px;margin-top:.35em}
.gr-team .tos i{display:block;width:.75em;height:.17em;background:#fff;opacity:.95}
.gr-team .tos i.used{opacity:.25}
.gr-score{font-size:clamp(22px,5vh,50px);font-weight:700;min-width:2.1em}
.gr-mid{background:#151b2b;flex:1;gap:0;font-size:clamp(14px,2.6vh,28px)}
.gr-mid span{white-space:nowrap;padding:0 1.15em;border-right:2px solid rgba(255,255,255,.18);line-height:1.3}
.gr-mid span:last-child{border:none}
.gr-arrow{display:inline-block;width:0;height:0;border-top:.38em solid transparent;border-bottom:.38em solid transparent;border-left:.55em solid #f5c518;margin-left:.6em;vertical-align:.05em}
.gr-mode{background:#151b2b;flex-direction:column;padding:0 1.4em;min-width:7em;font-size:clamp(12px,2.1vh,22px);line-height:1.15}
.gr-mode small{font-size:.72em;font-weight:500;opacity:.85}
.gr-toast{position:absolute;left:50%;top:16vh;transform:translate(-50%,0) scale(.9);opacity:0;transition:all .35s;background:rgba(21,27,43,.92);
  color:#fff;padding:.45em 1.3em;font-size:clamp(16px,3vh,30px);font-weight:700;border-radius:3px;letter-spacing:.04em;text-transform:uppercase;border-bottom:4px solid #f5c518}
.gr-toast.show{opacity:1;transform:translate(-50%,0) scale(1)}
`;

/**
 * Broadcast scorebug, styled after the reference image.
 * hud.set({ home:{score,timeouts}, away:{...}, quarter, clock, down, distance, possession:'home'|'away', mode, sub })
 */
export class HUD {
  constructor(container, teams) {
    if (!document.getElementById('gr-hud-css')) {
      const st = document.createElement('style'); st.id = 'gr-hud-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    this.teams = teams;
    const el = document.createElement('div');
    el.className = 'gr-hud';
    const h = teams.home, a = teams.away;
    el.innerHTML = `
      <div class="gr-bug">
        <div class="gr-team" style="background:linear-gradient(180deg,${h.hud || h.primary},${h.hudDark || h.primary})">
          ${wolfSVG({ outline: '#0d1b44', base: h.hud || h.primary, shade: h.hudDark || h.primary, light: '#eaf0ff', eye: '#ffffff' }, false)}
          <div class="name">${h.name}<div class="tos" data-k="homeTO"></div></div>
        </div>
        <div class="gr-score" data-k="homeScore" style="background:${h.hudDark || h.primary}">0</div>
        <div class="gr-mid">
          <span data-k="quarter">1ST</span><span data-k="clock">15:00</span><span><b data-k="down">1ST &amp; 10</b><i class="gr-arrow" data-k="arrow"></i></span>
        </div>
        <div class="gr-score" data-k="awayScore" style="background:${a.hudDark || a.primary}">0</div>
        <div class="gr-team" style="background:linear-gradient(180deg,${a.hud || a.primary},${a.hudDark || a.primary})">
          <div class="name">${a.name}<div class="tos" data-k="awayTO"></div></div>
          ${wolfSVG({ outline: '#3a0a0e', base: '#f2f2f2', shade: '#c9ccd2', light: a.hud || a.primary, eye: '#3a0a0e' }, true)}
        </div>
        <div class="gr-mode"><span data-k="mode">SIMULATION</span><small data-k="sub">CPU vs CPU</small></div>
      </div>
      <div class="gr-toast" data-k="toast"></div>`;
    container.appendChild(el);
    this.el = el;
    this.k = {};
    el.querySelectorAll('[data-k]').forEach(n => (this.k[n.dataset.k] = n));
    this.set({ home: { score: 0, timeouts: 3 }, away: { score: 0, timeouts: 3 } });
  }

  set(s) {
    const ord = n => ['', '1ST', '2ND', '3RD', '4TH'][n] || 'OT';
    if (s.home) { if (s.home.score != null) this.k.homeScore.textContent = s.home.score; if (s.home.timeouts != null) this.k.homeTO.innerHTML = [0, 1, 2].map(i => `<i class="${i < s.home.timeouts ? '' : 'used'}"></i>`).join(''); }
    if (s.away) { if (s.away.score != null) this.k.awayScore.textContent = s.away.score; if (s.away.timeouts != null) this.k.awayTO.innerHTML = [0, 1, 2].map(i => `<i class="${i < s.away.timeouts ? '' : 'used'}"></i>`).join(''); }
    if (s.quarter != null) this.k.quarter.textContent = ord(s.quarter);
    if (s.clock != null) {
      const c = Math.max(0, s.clock);
      this.k.clock.textContent = `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, '0')}`;
    }
    if (s.down != null) {
      const dist = s.goalToGo ? 'GOAL' : (s.distance < 1 ? 'INCHES' : Math.round(s.distance));
      this.k.down.textContent = `${ord(s.down)} & ${dist}`;
    }
    if (s.possession) {
      // arrow points toward the team with the ball
      this.k.arrow.style.transform = s.possession === 'home' ? 'scaleX(-1)' : 'none';
    }
    if (s.mode) this.k.mode.textContent = s.mode;
    if (s.sub) this.k.sub.textContent = s.sub;
  }

  toast(text, ms = 2200) {
    const t = this.k.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }
}
