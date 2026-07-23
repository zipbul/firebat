import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TempProject {
  readonly rootAbs: string;
  dispose: () => Promise<void>;
}

export const createTempProject = async (prefix: string): Promise<TempProject> => {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const rootAbs = await fs.realpath(raw);

  const dispose = async (): Promise<void> => {
    await fs.rm(rootAbs, { recursive: true, force: true });
  };

  return { rootAbs, dispose };
};

export const writeText = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
};

