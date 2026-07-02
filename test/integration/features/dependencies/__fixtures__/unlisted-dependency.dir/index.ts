import { readFileSync } from 'node:fs';
import { a } from 'declared-pkg';
import { p } from 'peer-pkg';
import { u } from 'unlisted-pkg';

const boot = (): unknown => [readFileSync, a, p, u];

boot();
