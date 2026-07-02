import { usedFn } from './lib';
import type { Contract } from './types';
import * as StarNs from './star-ns';
import { gamma } from './barrel';
import { usesHelperInternally } from './self-only';
import './prop-barrel';

const run = (c: Contract): unknown[] => [usedFn(), StarNs.alpha, gamma, c.id, usesHelperInternally()];

run({ id: 'x' });
