import { describe, expect, it } from 'bun:test';

import { shouldIncludeNoopEmptyCatch } from './noop-gating';

describe('noop-gating', () => {
  it('should include noop empty-catch when exception-hygiene is not selected', () => {
    // Arrange
    const exceptionHygieneSelected = false;
    // Act
    const include = shouldIncludeNoopEmptyCatch({ exceptionHygieneSelected });

    // Assert
    expect(include).toBe(true);
  });

  it('should exclude noop empty-catch when exception-hygiene runs ok', () => {
    // Arrange
    const exceptionHygieneSelected = true;
    // Act
    const include = shouldIncludeNoopEmptyCatch({ exceptionHygieneSelected, exceptionHygieneStatus: 'ok' });

    // Assert
    expect(include).toBe(false);
  });

  it('should include noop empty-catch when exception-hygiene is unavailable', () => {
    // Arrange
    const exceptionHygieneSelected = true;
    // Act
    const include = shouldIncludeNoopEmptyCatch({ exceptionHygieneSelected, exceptionHygieneStatus: 'unavailable' });

    // Assert
    expect(include).toBe(true);
  });

  it('should include noop empty-catch when exception-hygiene failed', () => {
    // Arrange
    const exceptionHygieneSelected = true;
    // Act
    const include = shouldIncludeNoopEmptyCatch({ exceptionHygieneSelected, exceptionHygieneStatus: 'failed' });

    // Assert
    expect(include).toBe(true);
  });

  it('should include noop empty-catch when exception-hygiene status is missing', () => {
    // Arrange
    const exceptionHygieneSelected = true;
    // Act
    const include = shouldIncludeNoopEmptyCatch({ exceptionHygieneSelected });

    // Assert
    expect(include).toBe(true);
  });
});
