import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { expandTargets } from './target-discovery';

describe('target-discovery', () => {
  it('should expand directory targets into ts/tsx files', async () => {
    // Arrange
    let input = ['src'];
    // Act
    let result = await expandTargets(input);

    // Assert
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(path.resolve('src/firebat.ts'));
  });

  it('should keep explicit .ts file targets', async () => {
    // Arrange
    let target = path.resolve('src/types.ts');
    // Act
    let result = await expandTargets([target]);

    // Assert
    expect(result).toEqual([target]);
  });
});
