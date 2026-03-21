// Fixture: 50+ line flat function with 8 variables simultaneously alive.
// All 8 variables are declared near the top and used at the final return,
// so every variable is live from its declaration to the end of the function.
// With maxLiveVariables: 7 and minFunctionLines: 10 this must emit
// exactly one liveness-pressure finding.
export function computeWithLivenessPressure(): number {
  const alpha = 1;
  const beta = 2;
  const gamma = 3;
  const delta = 4;
  const epsilon = 5;
  const zeta = 6;
  const eta = 7;
  const theta = 8;

  const pad00 = 0;
  const pad01 = 1;
  const pad02 = 2;
  const pad03 = 3;
  const pad04 = 4;
  const pad05 = 5;
  const pad06 = 6;
  const pad07 = 7;
  const pad08 = 8;
  const pad09 = 9;
  const pad10 = 10;
  const pad11 = 11;
  const pad12 = 12;
  const pad13 = 13;
  const pad14 = 14;
  const pad15 = 15;
  const pad16 = 16;
  const pad17 = 17;
  const pad18 = 18;
  const pad19 = 19;
  const pad20 = 20;
  const pad21 = 21;
  const pad22 = 22;
  const pad23 = 23;
  const pad24 = 24;
  const pad25 = 25;
  const pad26 = 26;
  const pad27 = 27;
  const pad28 = 28;
  const pad29 = 29;
  const pad30 = 30;
  const pad31 = 31;
  const pad32 = 32;
  const pad33 = 33;
  const pad34 = 34;
  const pad35 = 35;

  const _sink =
    pad00 + pad01 + pad02 + pad03 + pad04 + pad05 + pad06 + pad07 + pad08 + pad09 +
    pad10 + pad11 + pad12 + pad13 + pad14 + pad15 + pad16 + pad17 + pad18 + pad19 +
    pad20 + pad21 + pad22 + pad23 + pad24 + pad25 + pad26 + pad27 + pad28 + pad29 +
    pad30 + pad31 + pad32 + pad33 + pad34 + pad35;

  return alpha + beta + gamma + delta + epsilon + zeta + eta + theta + _sink;
}
