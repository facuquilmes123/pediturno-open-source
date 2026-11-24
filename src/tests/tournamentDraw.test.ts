/// <reference types="vitest/globals" />
import { describe, it, expect } from 'vitest';
import { generateAlgorithmicDraw, shuffleArray } from '@/lib/tournamentDraw';

describe('Tournament Draw Generator (Algorithmic / Non-AI)', () => {
  it('should shuffle array without losing items', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffleArray(input);
    expect(shuffled.length).toBe(input.length);
    expect(shuffled.sort()).toEqual(input.sort());
  });

  it('should generate balanced groups for tournament teams', () => {
    const teams = ['Boca', 'River', 'Racing', 'Independiente', 'San Lorenzo', 'Velez'];
    const result = generateAlgorithmicDraw({
      courtType: 'futbol',
      participants: teams,
      drawType: 'groups',
      numGroups: 2,
    });

    expect(result.draw.type).toBe('groups');
    if (result.draw.type === 'groups') {
      expect(result.draw.value.length).toBe(2);
      expect(result.draw.value[0].teams.length).toBe(3);
      expect(result.draw.value[1].teams.length).toBe(3);
    }
  });

  it('should generate random pairs for padel players', () => {
    const players = ['Juan', 'Pedro', 'Lucas', 'Martin', 'Diego', 'Agustin'];
    const result = generateAlgorithmicDraw({
      courtType: 'padel',
      participants: players,
      drawType: 'pairs',
    });

    expect(result.draw.type).toBe('pairs');
    if (result.draw.type === 'pairs') {
      expect(result.draw.value.length).toBe(3);
      result.draw.value.forEach(pair => {
        expect(pair.players.length).toBe(2);
      });
    }
  });

  it('should generate direct elimination bracket with BYE when participant count is not power of 2', () => {
    const players = ['Jugador 1', 'Jugador 2', 'Jugador 3', 'Jugador 4', 'Jugador 5', 'Jugador 6'];
    const result = generateAlgorithmicDraw({
      courtType: 'tenis',
      participants: players,
      drawType: 'individuals',
    });

    expect(result.draw.type).toBe('direct-elimination');
    if (result.draw.type === 'direct-elimination') {
      // For 6 players, nearest power of 2 is 8 -> 4 matches in round 1
      expect(result.draw.value.length).toBe(4);
      // There should be exactly 2 BYEs (8 - 6 = 2)
      const byeMatches = result.draw.value.filter(m => m.teams.includes('BYE'));
      expect(byeMatches.length).toBe(2);
    }
  });
});
