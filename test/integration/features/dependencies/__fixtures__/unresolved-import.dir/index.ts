import { realThing } from './real';
import { gone } from './missing-module';
// Consume `lost` so the re-export surface doesn't add an incidental dead-export
// to the snapshot (this fixture's intent is the two unresolved references only).
import { lost } from './reexport';

const boot = (): unknown => [realThing(), gone, lost];

boot();
