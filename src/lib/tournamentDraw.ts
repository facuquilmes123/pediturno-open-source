export interface Player {
  id: string;
  name: string;
}

export interface Pair {
  id: string;
  players: Player[];
}

export interface Group {
  id: string;
  name: string;
  teams: (Player | Pair)[];
}

export interface Match {
  id: string;
  round: number;
  teams: (Player | Pair | string)[];
}

export interface AlgorithmicDrawInput {
  courtType: 'futbol' | 'tenis' | 'padel' | 'otras';
  participants?: string[];
  predefinedPairs?: { player1: string; player2: string }[];
  drawType: 'groups' | 'pairs' | 'individuals';
  numGroups?: number;
  randomizePairs?: boolean;
}

export interface AlgorithmicDrawOutput {
  draw:
    | { type: 'groups'; value: Group[] }
    | { type: 'pairs'; value: Pair[] }
    | { type: 'direct-elimination'; value: Match[] };
}

/**
 * Fisher-Yates with Web Crypto and rejection sampling (no modulo bias).
 */
export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const range = i + 1;
    const upper = Math.floor(0x100000000 / range) * range;
    const random = new Uint32Array(1);
    do { crypto.getRandomValues(random); } while (random[0] >= upper);
    const j = random[0] % range;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Local randomized draw generator.
 * Eliminates external AI network calls, latency and quotas.
 */
export function generateAlgorithmicDraw(input: AlgorithmicDrawInput): AlgorithmicDrawOutput {
  const rawParticipants = (input.participants || [])
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(p => p.length > 0);

  // Case 1: Pairs draw (Pádel/Tenis or random teammate matching)
  if (input.drawType === 'pairs') {
    if (input.predefinedPairs && input.predefinedPairs.length > 0) {
      const pairs: Pair[] = input.predefinedPairs.map((p, idx) => ({
        id: `pair-${idx + 1}`,
        players: [
          { id: `p-${idx + 1}-1`, name: p.player1 || `Jugador ${idx * 2 + 1}` },
          { id: `p-${idx + 1}-2`, name: p.player2 || `Jugador ${idx * 2 + 2}` },
        ],
      }));
      return {
        draw: {
          type: 'pairs',
          value: pairs,
        },
      };
    }

    const shuffled = shuffleArray(rawParticipants);
    const pairs: Pair[] = [];

    for (let i = 0; i < shuffled.length; i += 2) {
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];
      const players: Player[] = [{ id: `p-${i + 1}`, name: p1 }];
      if (p2) {
        players.push({ id: `p-${i + 2}`, name: p2 });
      }
      pairs.push({
        id: `pair-${Math.floor(i / 2) + 1}`,
        players,
      });
    }

    return {
      draw: {
        type: 'pairs',
        value: pairs,
      },
    };
  }

  // Build the list of entities (Teams/Pairs or individual Players)
  let entities: (Player | Pair)[] = [];
  if (input.predefinedPairs && input.predefinedPairs.length > 0) {
    entities = input.predefinedPairs.map((p, idx) => ({
      id: `pair-${idx + 1}`,
      players: [
        { id: `p-${idx + 1}-1`, name: p.player1 },
        { id: `p-${idx + 1}-2`, name: p.player2 },
      ],
      name: `${p.player1} & ${p.player2}`,
    } as any));
  } else {
    entities = rawParticipants.map((name, idx) => ({
      id: `participant-${idx + 1}`,
      name,
    }));
  }

  // Shuffle entities for a fair draw
  const shuffledEntities = shuffleArray(entities);

  // Case 2: Group stage draw
  if (input.drawType === 'groups') {
    const numGroups = Math.max(1, Math.min(input.numGroups || 2, shuffledEntities.length || 2));
    const groupNames = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const groups: Group[] = Array.from({ length: numGroups }, (_, i) => ({
      id: `group-${i + 1}`,
      name: `Grupo ${groupNames[i % groupNames.length]}`,
      teams: [],
    }));

    // Distribute entities evenly across groups (Snake or Round-robin)
    shuffledEntities.forEach((entity, idx) => {
      groups[idx % numGroups].teams.push(entity);
    });

    return {
      draw: {
        type: 'groups',
        value: groups,
      },
    };
  }

  // Case 3: Direct elimination (Bracket)
  // Find nearest power of 2
  const total = shuffledEntities.length;
  let power = 2;
  while (power < total) {
    power *= 2;
  }

  const byesCount = power - total;
  const matches: Match[] = [];
  const matchCount = power / 2;

  // Distribute Byes evenly to top seeds / positions
  let entityIdx = 0;
  for (let m = 0; m < matchCount; m++) {
    const team1 = shuffledEntities[entityIdx++];
    // If we have remaining byes, team2 is 'BYE'
    let team2: Player | Pair | string;
    if (m < byesCount) {
      team2 = 'BYE';
    } else {
      team2 = shuffledEntities[entityIdx++] || 'BYE';
    }

    matches.push({
      id: `match-${m + 1}`,
      round: 1,
      teams: [team1 || { id: `bye-${m}`, name: 'BYE' }, team2],
    });
  }

  return {
    draw: {
      type: 'direct-elimination',
      value: matches,
    },
  };
}
