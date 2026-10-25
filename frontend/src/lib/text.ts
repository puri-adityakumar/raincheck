/** Match Python's Unicode code-point bounds, not JavaScript's UTF-16 units. */
export const textLength = (value: string): number => Array.from(value).length;

export const limitText = (value: string, max: number): string => Array.from(value).slice(0, max).join('');
