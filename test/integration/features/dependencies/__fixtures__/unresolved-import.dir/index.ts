import { realThing } from './real';
import { gone } from './missing-module';
import './reexport';

const boot = (): unknown => [realThing(), gone];

boot();
