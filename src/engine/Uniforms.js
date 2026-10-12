// ---------------------------------------------------------------------------
// Uniform sets. Each team can define `uniforms: { home, away, alt }` with any
// subset of the region colours below; everything else is derived from the
// team's primary / secondary colours. `team.uniform` picks which set is worn.
// ---------------------------------------------------------------------------

const WHITE = '#f4f6f9';

/** Region colours for a team's uniform set: 'home' | 'away' | 'alt'. */
export function resolveKit(team, which = team.uniform || 'home') {
  const P = team.primary, S = team.secondary || P;
  const base = {
    home: {
      jersey: P, trim: WHITE, number: WHITE, numberOutline: S,
      pants: team.pants || WHITE, pantStripe: P,
      socks: P, sockBand: WHITE,
      helmet: team.helmet || WHITE, helmetStripe: P, mask: team.facemask || WHITE,
      gloves: P, cleats: P, cleatTrim: WHITE,
    },
    away: {
      jersey: WHITE, trim: P, number: P, numberOutline: S,
      pants: P, pantStripe: WHITE,
      socks: P, sockBand: WHITE,
      helmet: team.helmet || WHITE, helmetStripe: P, mask: team.facemask || WHITE,
      gloves: P, cleats: P, cleatTrim: WHITE,
    },
    alt: {
      jersey: S, trim: WHITE, number: WHITE, numberOutline: P,
      pants: S, pantStripe: P,
      socks: S, sockBand: WHITE,
      helmet: P, helmetStripe: WHITE, mask: WHITE,
      gloves: S, cleats: S, cleatTrim: WHITE,
    },
  }[which] || {};
  return { ...base, ...(team.uniforms?.[which] || {}), which };
}
