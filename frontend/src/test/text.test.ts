import { describe, expect, it } from 'vitest';
import { limitText, textLength } from '../lib/text';

describe('Unicode code-point bounds', () => {
  it('counts supplementary characters once and combining marks separately, like Python', () => {
    expect(textLength('A𠮷🦆')).toBe(3);
    expect(textLength('e\u0301')).toBe(2);
  });
  it('truncates at a code-point boundary without splitting a surrogate pair', () => {
    expect(limitText('A𠮷🦆B', 3)).toBe('A𠮷🦆');
    expect(limitText('𠮷'.repeat(41), 40)).toBe('𠮷'.repeat(40));
  });
});
