// cards.js — 60-card set for Jack Jackson: Resonance Duel
// Exports: { cards, drawCards, applyResonance, applyStability, shuffle }

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function clamp(n, min = 0, max = 999) {
  return Math.max(min, Math.min(n, max));
}

/**
 * Draw up to `count` cards from room.deck into player.hand.
 * Reshuffles discard into deck automatically if needed.
 * Enforces maxHandSize (default 6).
 */
function drawCards(player, room, count = 1, maxHandSize = 6) {
  if (!room || !player || count <= 0) return;
  if (!Array.isArray(player.hand)) player.hand = [];
  for (let i = 0; i < count; i++) {
    if (player.hand.length >= maxHandSize) break;
    if (!room.deck || room.deck.length === 0) {
      if (room.discard && room.discard.length > 0) {
        room.deck = shuffle([...room.discard]);
        room.discard = [];
      } else {
        break; // no cards available
      }
    }
    const card = room.deck.pop();
    if (card) player.hand.push(card);
  }
}

/**
 * Apply resonance change to player.
 * Negative amounts are resonance damage.
 * If amount < 0 and player.avoidNextResonance is set, consume it and ignore.
 */
function applyResonance(player, amount) {
  if (!player || typeof amount !== 'number') return;
  if (amount < 0 && player.avoidNextResonance) {
    player.avoidNextResonance = false;
    return;
  }
  player.resonance = clamp((player.resonance || 0) + amount, 0, 999);
}

/**
 * Apply stability change to player.
 * Negative amounts are damage.
 * If amount < 0 and player.skipNextDamage is set, consume it and ignore.
 * If stability <= 0 after change, mark alive = false.
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

/* =========================
   Card list (60 unique)
   Each card: { id, name, type, cost, effect, action(player, target, room) }
   The 'action' function manipulates player, target, and room as needed.
   ========================= */

const cards = [
  // 1
  {
    id: 1, name: "Echo Drain", type: "Spell", cost: 3,
    effect: "Target -2 stability; you +2 resonance.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyStability(target, -2);
      applyResonance(player, +2);
    }
  },

  // 2
  {
    id: 2, name: "Layer Shift", type: "Spell", cost: 2,
    effect: "Swap resonance with target.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      const t = target.resonance || 0;
      const p = player.resonance || 0;
      target.resonance = p;
      player.resonance = t;
    }
  },

  // 3
  {
    id: 3, name: "Fragment Recall", type: "Spell", cost: 2,
    effect: "Draw 2 cards.",
    action: (player, _, room) => drawCards(player, room, 2)
  },

  // 4
  {
    id: 4, name: "Overload Surge", type: "Spell", cost: 2,
    effect: "Gain +3 resonance; lose 1 stability.",
    action: (player) => {
      applyResonance(player, +3);
      applyStability(player, -1);
    }
  },

  // 5
  {
    id: 5, name: "Timeline Lock", type: "Spell", cost: 3,
    effect: "Target skips their next turn.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.skipTurn = true;
    }
  },

  // 6
  {
    id: 6, name: "Resonant Pulse", type: "Spell", cost: 3,
    effect: "All other players -1 resonance.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        if (p.id !== player.id) applyResonance(p, -1);
      });
    }
  },

  // 7
  {
    id: 7, name: "Echo Shield", type: "Artifact", cost: 2,
    effect: "+1 stability; avoid next resonance damage.",
    action: (player) => {
      applyStability(player, +1);
      player.avoidNextResonance = true;
    }
  },

  // 8
  {
    id: 8, name: "Dimensional Rift", type: "Event", cost: 3,
    effect: "All others -1 stability; you draw 1.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        if (p.id !== player.id) applyStability(p, -1);
      });
      drawCards(player, room, 1);
    }
  },

  // 9
  {
    id: 9, name: "Essence Vial", type: "Potion", cost: 0,
    effect: "+3 resonance.",
    action: (player) => applyResonance(player, +3)
  },

  // 10
  {
    id: 10, name: "Overlapping Self", type: "Spell", cost: 4,
    effect: "Copy last non-event card into your hand.",
    action: (player, _, room) => {
      if (!room || !Array.isArray(room.table)) return;
      for (let i = room.table.length - 1; i >= 0; i--) {
        const entry = room.table[i];
        if (!entry || !entry.card) continue;
        const c = entry.card;
        if (c.type === "Event" || c.name === "Overlapping Self") continue;
        // clone from template if available (avoid sharing references)
        const template = cards.find(cd => cd.id === c.id);
        if (template) player.hand.push({ ...template });
        return;
      }
    }
  },

  // 11
  {
    id: 11, name: "Disarmonia Attack", type: "Spell", cost: 3,
    effect: "Halve target's stability (rounded down).",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.stability = Math.floor((target.stability || 0) / 2);
      if (target.stability <= 0) target.alive = false;
    }
  },

  // 12
  {
    id: 12, name: "Fragment Merge", type: "Spell", cost: 2,
    effect: "If resonance >3, gain stability = resonance-3.",
    action: (player) => {
      const r = player.resonance || 0;
      if (r > 3) applyStability(player, r - 3);
    }
  },

  // 13
  {
    id: 13, name: "Unseen Echo", type: "Spell", cost: 3,
    effect: "Steal a random card from target.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      if (!Array.isArray(target.hand) || target.hand.length === 0) return;
      const idx = Math.floor(Math.random() * target.hand.length);
      const stolen = target.hand.splice(idx, 1)[0];
      if (stolen) player.hand.push(stolen);
    }
  },

  // 14
  {
    id: 14, name: "Reality Tear", type: "Event", cost: 4,
    effect: "All others -1 stability; you +1 resonance.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        if (p.id !== player.id) applyStability(p, -1);
      });
      applyResonance(player, +1);
    }
  },

  // 15
  {
    id: 15, name: "Anchor Stone", type: "Artifact", cost: 3,
    effect: "Set target resonance to 0.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.resonance = 0;
    }
  },

  // 16
  {
    id: 16, name: "Collapse", type: "Spell", cost: 4,
    effect: "Target resonance -> 0; you -1 stability.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      target.resonance = 0;
      applyStability(player, -1);
    }
  },

  // 17
  {
    id: 17, name: "Echo Call", type: "Spell", cost: 2,
    effect: "Draw 1; all players gain +1 resonance.",
    action: (player, _, room) => {
      drawCards(player, room, 1);
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => applyResonance(p, +1));
    }
  },

  // 18
  {
    id: 18, name: "Reflective Pulse", type: "Spell", cost: 3,
    effect: "Reflect the next spell cast against you.",
    action: (player) => { player.reflectNext = true; }
  },

  // 19
  {
    id: 19, name: "Timeless Veil", type: "Artifact", cost: 3,
    effect: "Ignore your next stability loss.",
    action: (player) => { player.skipNextDamage = true; }
  },

  // 20
  {
    id: 20, name: "Shattered Self", type: "Spell", cost: 3,
    effect: "Lose 2 stability; draw 3 cards.",
    action: (player, _, room) => {
      applyStability(player, -2);
      drawCards(player, room, 3);
    }
  },

  // 21
  {
    id: 21, name: "Phase Shift", type: "Spell", cost: 2,
    effect: "Avoid next resonance damage.",
    action: (player) => { player.avoidNextResonance = true; }
  },

  // 22
  {
  id: 22,
  name: "Residual Echo",
  cost: 1,
  description: "Gain +1 Resonance but lose 1 Stability.",
  action: (player) => {
    player.resonance += 2;
    player.stability -= 1;
  }
},

  // 23
  {
    id: 23, name: "Echoes of Healing", type: "Spell", cost: 4,
    effect: "+3 stability.",
    action: (player) => applyStability(player, +3)
  },

  // 24
  {
    id: 24, name: "Temporal Collapse", type: "Event", cost: 5,
    effect: "All -1 stability; all +2 resonance.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        applyStability(p, -1);
        applyResonance(p, +2);
      });
    }
  },

  // 25
  {
    id: 25, name: "Rebound", type: "Spell", cost: 2,
    effect: "Return last discarded card to your hand.",
    action: (player, _, room) => {
      if (!room || !Array.isArray(room.discard) || room.discard.length === 0) return;
      const card = room.discard.pop();
      if (card) player.hand.push(card);
    }
  },

  // 26
  {
    id: 26, name: "Echo Trap", type: "Artifact", cost: 3,
    effect: "Target loses 1 resonance immediately.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyResonance(target, -1);
    }
  },

  // 27
  {
    id: 27, name: "Layer Fusion", type: "Spell", cost: 4,
    effect: "Average resonance; you gain stability = average.",
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

  // 28
  {
    id: 28, name: "Dissolve", type: "Spell", cost: 2,
    effect: "Deal 2 stability damage to target.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyStability(target, -2);
    }
  },

  // 29
  {
    id: 29, name: "Jack's Ascension", type: "Event", cost: 5,
    effect: "+2 stability; resonance→3; discard up to 2 cards.",
    action: (player) => {
      applyStability(player, +2);
      player.resonance = 3;
      if (Array.isArray(player.hand) && player.hand.length > 0) {
        const discardCount = Math.min(2, player.hand.length);
        player.hand.splice(Math.max(0, player.hand.length - discardCount), discardCount);
      }
    }
  },

  // 30 (new offensive)
  {
    id: 30, name: "Resonance Burst", type: "Spell", cost: 2,
    effect: "Deal 2 resonance damage to target.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyResonance(target, -2);
    }
  },

  // 31
  {
    id: 31, name: "Entropy Pulse", type: "Event", cost: 3,
    effect: "All players lose 1 stability.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => applyStability(p, -1));
    }
  },

  // 32
  {
    id: 32, name: "Mind Fracture", type: "Spell", cost: 2,
    effect: "Target discards a random card.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      if (!Array.isArray(target.hand) || target.hand.length === 0) return;
      const idx = Math.floor(Math.random() * target.hand.length);
      target.hand.splice(idx, 1);
    }
  },

  // 33
  {
    id: 33, name: "Void Torrent", type: "Spell", cost: 3,
    effect: "Target -3 resonance; you -1 stability.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      applyResonance(target, -3);
      applyStability(player, -1);
    }
  },

  // 34
  {
    id: 34, name: "Spectral Break", type: "Spell", cost: 3,
    effect: "Deal 2 stability if target has more resonance than you.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      if ((target.resonance || 0) > (player.resonance || 0)) applyStability(target, -2);
    }
  },

  // 35
{
  id: 35,
  name: "Overtone Slash",
  cost: 2,
  description: "Deal 3 Stability damage to target.",
  action: (player, target) => {
    if (!target) return;
    target.stability -= 3;
  }
},

  // 36 (defensive)
  {
    id: 36, name: "Phase Cloak", type: "Artifact", cost: 3,
    effect: "Ignore all damage this turn (server must respect 'phaseCloak' flag at apply).",
    action: (player) => { player.phaseCloak = true; }
  },

  // 37
  {
    id: 37, name: "Resonant Barrier", type: "Artifact", cost: 2,
    effect: "+2 stability.",
    action: (player) => applyStability(player, +2)
  },

  // 38
  {
    id: 38, name: "Echo Mirror", type: "Artifact", cost: 3,
    effect: "Reflect next resonance damage back to source.",
    action: (player) => { player.reflectResonanceNext = true; }
  },

  // 39
  {
    id: 39, name: "Time Anchor", type: "Artifact", cost: 2,
    effect: "Resonance cannot drop below 1 until your next turn.",
    action: (player) => { player.anchored = true; }
  },

  // 40
  {
    id: 40, name: "Energy Reversal", type: "Spell", cost: 3,
    effect: "Convert next stability damage into +2 resonance.",
    action: (player) => { player.reversalNext = true; }
  },

  // 41
  {
    id: 41, name: "Silent Refrain", type: "Spell", cost: 2,
    effect: "Skip your next turn to heal +3 stability.",
    action: (player) => {
      player.skipTurn = true;
      applyStability(player, +3);
    }
  },

  // 42 (utility)
  {
    id: 42, name: "Harmonic Draw", type: "Spell", cost: 1,
    effect: "Draw 1; gain +1 resonance.",
    action: (player, _, room) => {
      drawCards(player, room, 1);
      applyResonance(player, +1);
    }
  },

  // 43
  {
    id: 43, name: "Mirror World", type: "Spell", cost: 3,
    effect: "Swap hand sizes with target.",
    action: (player, target) => {
      if (!target || target.id === player.id) return;
      const pHand = player.hand || [];
      const tHand = target.hand || [];
      const tmp = pHand.slice();
      player.hand = tHand.slice();
      target.hand = tmp;
    }
  },

  // 44
  {
    id: 44, name: "Fractured Path", type: "Spell", cost: 2,
    effect: "Return a discarded card of your choice to your hand.",
    action: (player, _, room) => {
      if (!room || !Array.isArray(room.discard) || room.discard.length === 0) return;
      // pick last discarded (client could offer choice; server picks last)
      const card = room.discard.pop();
      if (card) player.hand.push(card);
    }
  },

  // 45
  {
    id: 45, name: "Echo Step", type: "Spell", cost: 4,
    effect: "Take another turn after this one.",
    action: (player) => { player.extraTurn = true; } // server should handle extraTurn when advancing
  },

  // 46
  {
    id: 46, name: "Dimensional Key", type: "Artifact", cost: 3,
    effect: "Search deck for an Artifact and add to hand (shuffle deck).",
    action: (player, _, room) => {
      if (!room) return;
      // search deck for first artifact
      if (!room.deck || room.deck.length === 0) {
        if (room.discard && room.discard.length) { room.deck = shuffle([...room.discard]); room.discard = []; }
      }
      let foundIdx = -1;
      for (let i = room.deck.length - 1; i >= 0; i--) {
        if (room.deck[i] && room.deck[i].type === "Artifact") { foundIdx = i; break; }
      }
      if (foundIdx >= 0) {
        const card = room.deck.splice(foundIdx, 1)[0];
        if (card) player.hand.push(card);
      } else {
        // no artifact found: draw 1 as fallback
        drawCards(player, room, 1);
      }
      // shuffle deck
      room.deck = shuffle(room.deck);
    }
  },

  // 47
  {
    id: 47, name: "Mana Realignment", type: "Spell", cost: 3,
    effect: "Set your resonance to the average of all players (floor).",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      const all = Object.values(room.players);
      const avg = Math.floor(all.reduce((s, p) => s + (p.resonance || 0), 0) / Math.max(1, all.length));
      player.resonance = avg;
    }
  },

  // 48 (event)
  {
    id: 48, name: "Resonant Storm", type: "Event", cost: 3,
    effect: "All players -1 stability; reshuffle discard into deck.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => applyStability(p, -1));
      if (room.discard && room.discard.length > 0) {
        room.deck = shuffle(room.deck.concat(room.discard || []));
        room.discard = [];
      }
    }
  },

  // 49
  {
    id: 49, name: "Fractal Collapse", type: "Event", cost: 3,
    effect: "All players discard 1 random card.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        if (!Array.isArray(p.hand) || p.hand.length === 0) return;
        const idx = Math.floor(Math.random() * p.hand.length);
        p.hand.splice(idx, 1);
      });
    }
  },

  // 50
  {
    id: 50, name: "Temporal Rewind", type: "Event", cost: 3,
    effect: "All players draw 1 then lose 1 resonance.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => {
        drawCards(p, room, 1);
        applyResonance(p, -1);
      });
    }
  },

  // 51
  {
    id: 51, name: "Echo Bloom", type: "Event", cost: 3,
    effect: "All players +1 stability.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      Object.values(room.players).forEach(p => applyStability(p, +1));
    }
  },

  // 52
 {
  id: 52, name: "Silence Field", type: "Event", cost: 4,
  effect: "No one can play cards until your next turn.",
  action: (player, _, room) => {
    if (!room || !room.players) return;
    room.silencedBy = player.id;
    setTimeout(() => {
      if (room.silencedBy === player.id) room.silencedBy = null;
    }, 10000); // auto-clear after 10s (or on next turn)
  }
},

  // 53
  {
    id: 53, name: "Resonant Shift", type: "Event", cost: 4,
    effect: "Shuffle all resonance values among players.",
    action: (player, _, room) => {
      if (!room || !room.players) return;
      const players = Object.values(room.players);
      const vals = players.map(p => p.resonance || 0);
      // shuffle vals and reassign
      for (let i = vals.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [vals[i], vals[j]] = [vals[j], vals[i]];
      }
      players.forEach((p, idx) => p.resonance = vals[idx]);
    }
  },

  // 54
  {
    id: 54, name: "Pulse Conduit", type: "Artifact", cost: 3,
    effect: "Whenever you gain resonance, gain +1 extra (flag).",
    action: (player) => { player.pulseConduit = true; }
  },

  // 55
  {
    id: 55, name: "Shard Totem", type: "Artifact", cost: 3,
    effect: "At end of your turn, gain +1 stability (flag).",
    action: (player) => { player.shardTotem = true; }
  },

  // 56
  {
    id: 56, name: "Mana Flask", type: "Potion", cost: 0,
    effect: "Restore +2 resonance.",
    action: (player) => applyResonance(player, +2)
  },

  // 57
  {
    id: 57, name: "Reflective Core", type: "Artifact", cost: 4,
    effect: "Reflect first damaging spell each turn (flag).",
    action: (player) => { player.reflectiveCore = true; }
  },

  // 58
  {
    id: 58, name: "Temporal Compass", type: "Artifact", cost: 3,
    effect: "You cannot have your turns skipped (flag).",
    action: (player) => { player.compass = true; }
  },

  // 59
  {
    id: 59, name: "Echo Catalyst", type: "Artifact", cost: 4,
    effect: "Whenever you play a Spell, draw 1 card (flag).",
    action: (player) => { player.echoCatalyst = true; }
  },

  // 60
  {
    id: 60, name: "Spectral Recall", type: "Spell", cost: 3,
    effect: "If you have no cards, draw 3; otherwise draw 1.",
    action: (player, _, room) => {
      const handSize = Array.isArray(player.hand) ? player.hand.length : 0;
      if (handSize === 0) drawCards(player, room, 3);
      else drawCards(player, room, 1);
    }
  }
];

module.exports = {
  cards,
  drawCards,
  applyResonance,
  applyStability,
  shuffle
};


