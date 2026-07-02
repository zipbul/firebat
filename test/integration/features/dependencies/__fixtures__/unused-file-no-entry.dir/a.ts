// Entry-hold K: no package.json main and no test/config files → zero entry
// points → unused-file judgment is HELD (orphan.ts must NOT be reported).
// Nothing is exported so the snapshot stays free of incidental dead-exports.
import { b } from './b';

const a = (): number => b();

a();
