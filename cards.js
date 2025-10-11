// cards.js - full patched card set (replace your current cards module with this)
// Includes helper functions used by cards (draw, clamp, applyResonance, applyStability)

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function clamp(n, min = 0, max = 999) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Draw 'count' cards from room.deck into player.hand.
 * Reshuffles discard into deck automatically if needed.
 */
function drawCards(player, room, count = 1) {
  if (!room || !player) return;
  for (let i = 0; i < count; i++) {
    if (!room.deck || room.deck.length === 0) {
      if (room.discard && room.discard.length > 0) {
        room.deck = shuffle([...room.discard]);
        room.discard = [];
      } else {
        break; // no cards to draw
      }
    }
    const card = room.deck.pop();
    if (card) player.hand.push(card);
  }
}

/**
 * Apply resonance to a player respecting avoid-next flags.
 * Negative amounts are resonance damage.
 */
function applyResonance(player, amount) {
  if (!player || typeof amount !== 'number') return;
  // If negative and player avoids the next resonance hit, consume flag and ignore
  if (amount < 0 && player.avoidNextResonance) {
    player.avoidNextResonance = false;
    return;
  }
  player.resonance = clamp((player.resonance || 0) + amount, 0, 999);
}

/**
 * Apply stability changes (damage/heal) respecting skipNextDamage flag.
 * Negative amounts are damage.
 */
function applyStability(player, amount) {
  if (!player || typeof amount !== 'number') return;
  if (amount < 0 && player.skipNextDamage) {
    player.skipNextDamage = false;
    return;
  }
  player.stability = clamp((player.stability || 0) + amount, -999, 999);
  if (player.stability <= 0) player.alive = false;
}

/* === Card Definitions ===
   Each action signature: (player, target, room)
   - 'player' is the actor (object)
   - 'target' is the targeted player object or null
   - 'room' is the room object (deck/discard/table/players)
*/

const cards = [
  { id: 1, name: "Echo Drain", type: "Spell", cost: 2,
    effect: "Target loses 2 stability; you gain 2 resonance.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyStability(target, -2);
      applyResonance(player, +2);
    }
  },

  { id: 2, name: "Layer Shift", type: "Spell", cost: 1,
    effect: "Swap resonance with another player.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      const tRes = target.resonance || 0;
      const pRes = player.resonance || 0;
      target.resonance = pRes;
      player.resonance = tRes;
    }
  },

  { id: 3, name: "Fragment Recall", type: "Spell", cost: 1,
    effect: "Draw 2 cards.",
    action: (player, _, room) => drawCards(player, room, 2)
  },

  { id: 4, name: "Overload Surge", type: "Spell", cost: 1,
    effect: "Gain 3 resonance; lose 1 stability.",
    action: (player) => {
      applyResonance(player, +3);
      applyStability(player, -1);
    }
  },

  { id: 5, name: "Timeline Lock", type: "Spell", cost: 3,
    effect: "Target skips their next turn.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.skipTurn = true;
    }
  },

  { id: 6, name: "Resonant Pulse", type: "Spell", cost: 2,
    effect: "Deal 1 resonance damage to all other players.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        if (p.id !== player.id) applyResonance(p, -1);
      });
    }
  },

  { id: 7, name: "Echo Shield", type: "Artifact", cost: 2,
    effect: "Gain 1 stability; avoid next resonance damage.",
    action: (player) => {
      applyStability(player, +1);
      player.avoidNextResonance = true;
    }
  },

  { id: 8, name: "Dimensional Rift", type: "Event", cost: 2,
    effect: "All other players lose 1 stability; you draw 1 card.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        if (p.id !== player.id) applyStability(p, -1);
      });
      drawCards(player, room, 1);
    }
  },

  { id: 9, name: "Essence Vial", type: "Potion", cost: 0,
    effect: "Gain 3 resonance.",
    action: (player) => applyResonance(player, +3)
  },

  { id: 10, name: "Overlapping Self", type: "Spell", cost: 3,
    effect: "Copy the last non-event, non-copy card into your hand.",
    action: (player, _, room) => {
      if (!room || !Array.isArray(room.table) || room.table.length === 0) return;
      // find last eligible played card entry (reverse)
      for (let i = room.table.length - 1; i >= 0; i--) {
        const entry = room.table[i];
        if (!entry || !entry.card) continue;
        const c = entry.card;
        if (c.name === "Overlapping Self") continue;
        if (c.type === "Event") continue;
        // shallow clone and push to hand (safer than immediate execution)
        const clone = Object.assign({}, c);
        player.hand.push(clone);
        return;
      }
    }
  },

  { id: 11, name: "Disarmonia Attack", type: "Spell", cost: 2,
    effect: "Halve target's stability (rounded down).",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.stability = Math.floor((target.stability || 0) / 2);
      if (target.stability <= 0) target.alive = false;
    }
  },

  { id: 12, name: "Fragment Merge", type: "Spell", cost: 1,
    effect: "If you have more than 3 resonance, gain stability equal to resonance-3.",
    action: (player) => {
      const r = player.resonance || 0;
      if (r > 3) applyStability(player, r - 3);
    }
  },

  { id: 13, name: "Unseen Echo", type: "Spell", cost: 2,
    effect: "Steal a random card from target.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      if (!Array.isArray(target.hand) || target.hand.length === 0) return;
      const idx = Math.floor(Math.random() * target.hand.length);
      const stolen = target.hand.splice(idx, 1)[0];
      if (stolen) player.hand.push(stolen);
    }
  },

  { id: 14, name: "Reality Tear", type: "Event", cost: 3,
    effect: "All others lose 1 stability; you gain 1 resonance.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        if (p.id !== player.id) applyStability(p, -1);
      });
      applyResonance(player, +1);
    }
  },

  { id: 15, name: "Anchor Stone", type: "Artifact", cost: 2,
    effect: "Set target's resonance to 0.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.resonance = 0;
    }
  },

  { id: 16, name: "Frequency Swap", type: "Spell", cost: 2,
    effect: "Swap resonance with another player.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      const tRes = target.resonance || 0;
      const pRes = player.resonance || 0;
      target.resonance = pRes;
      player.resonance = tRes;
    }
  },

  { id: 17, name: "Collapse", type: "Spell", cost: 3,
    effect: "Target loses all resonance; you lose 1 stability.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.resonance = 0;
      applyStability(player, -1);
    }
  },

  { id: 18, name: "Echo Call", type: "Spell", cost: 1,
    effect: "Draw 1 card; all players gain 1 resonance.",
    action: (player, _, room) => {
      drawCards(player, room, 1);
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => applyResonance(p, +1));
    }
  },

  { id: 19, name: "Reflective Pulse", type: "Spell", cost: 2,
    effect: "Reflect the next spell back to caster.",
    action: (player) => { player.reflectNext = true; }
  },

  { id: 20, name: "Timeless Veil", type: "Artifact", cost: 2,
    effect: "Ignore your next stability loss.",
    action: (player) => { player.skipNextDamage = true; }
  },

  { id: 21, name: "Shattered Self", type: "Spell", cost: 2,
    effect: "Lose 2 stability; draw 3 cards.",
    action: (player, _, room) => {
      applyStability(player, -2);
      drawCards(player, room, 3);
    }
  },

  { id: 22, name: "Phase Shift", type: "Spell", cost: 1,
    effect: "Avoid the next resonance damage that would hit you.",
    action: (player) => { player.avoidNextResonance = true; }
  },

  { id: 23, name: "Residual Echo", type: "Spell", cost: 1,
    effect: "Gain 2 resonance; lose 1 stability.",
    action: (player) => {
      applyResonance(player, +2);
      applyStability(player, -1);
    }
  },

  { id: 24, name: "Echoes of Healing", type: "Spell", cost: 3,
    effect: "Gain 3 stability.",
    action: (player) => applyStability(player, +3)
  },

  { id: 25, name: "Temporal Collapse", type: "Event", cost: 3,
    effect: "All players lose 1 stability and gain 2 resonance.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        applyStability(p, -1);
        applyResonance(p, +2);
      });
    }
  },

  { id: 26, name: "Rebound", type: "Spell", cost: 1,
    effect: "Return the last discarded card to your hand (if any).",
    action: (player, _, room) => {
      if (!room || !Array.isArray(room.discard) || room.discard.length === 0) return;
      const card = room.discard.pop();
      if (card) player.hand.push(card);
    }
  },

  { id: 27, name: "Echo Trap", type: "Artifact", cost: 2,
    effect: "Target loses 1 resonance immediately.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyResonance(target, -1);
    }
  },

  { id: 28, name: "Layer Fusion", type: "Spell", cost: 3,
    effect: "Average your and target's resonance; both are set to that average; you gain stability equal to that average.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      const pR = player.resonance || 0;
      const tR = target.resonance || 0;
      const avg = Math.floor((pR + tR) / 2);
      player.resonance = avg;
      target.resonance = avg;
      applyStability(player, avg);
    }
  },

  { id: 29, name: "Dissolve", type: "Spell", cost: 1,
    effect: "Spend 1 resonance to deal 2 stability damage to target.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyStability(target, -2);
    }
  },

  { id: 30, name: "Jack’s Ascension", type: "Event", cost: 5,
    effect: "Gain 2 stability; set resonance to 3; discard up to 2 cards.",
    action: (player) => {
      applyStability(player, +2);
      player.resonance = 3;
      // safely discard up to 2 cards from end of hand
      if (Array.isArray(player.hand) && player.hand.length > 0) {
        const discardCount = Math.min(2, player.hand.length);
        player.hand.splice(Math.max(0, player.hand.length - discardCount), discardCount);
      }
    }
  }
];

module.exports = { cards, drawCards, applyResonance, applyStability, shuffle };
