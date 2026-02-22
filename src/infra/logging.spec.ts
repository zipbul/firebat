import { describe, it, expect, afterAll } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { appendFirebatLog } from './logging';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-logging-test-'));

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('appendFirebatLog', () => {
  it('[HP] creates the log file and appends a message', async () => {
    const logRelPath = 'logs/test.log';
    await appendFirebatLog(tmpDir, logRelPath, 'hello log');
    const content = await fs.readFile(path.join(tmpDir, logRelPath), 'utf8');
    expect(content).toContain('hello log');
  });

  it('[HP] appended entry includes ISO timestamp bracket and newline', async () => {
    const logRelPath = 'logs/ts-test.log';
    await appendFirebatLog(tmpDir, logRelPath, 'message');
    const content = await fs.readFile(path.join(tmpDir, logRelPath), 'utf8');
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(content).toEndWith('\n');
  });

  it('[HP] creates nested directories automatically', async () => {
    const deepRelPath = 'a/b/c/deep.log';
    await appendFirebatLog(tmpDir, deepRelPath, 'deep');
    const content = await fs.readFile(path.join(tmpDir, deepRelPath), 'utf8');
    expect(content).toContain('deep');
  });

  it('[HP] appending multiple times accumulates entries', async () => {
    const logRelPath = 'logs/multi.log';
    await appendFirebatLog(tmpDir, logRelPath, 'first');
    await appendFirebatLog(tmpDir, logRelPath, 'second');
    const content = await fs.readFile(path.join(tmpDir, logRelPath), 'utf8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });
});
