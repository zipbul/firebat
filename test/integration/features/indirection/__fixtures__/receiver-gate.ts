// receiver gate (③): only a wrapper-parameter receiver is inlinable (W);
// external-object / this / class-method receivers → K.
class Svc { real(x: number): number { return x; } }
const svc = new Svc();

// W — receiver is the wrapper's own parameter `p`.
function wParamRecv(p: Svc, x: number): number { return p.real(x); }
wParamRecv(svc, 1);

// K — external object receiver (svc is not a parameter).
function wExtObj(x: number): number { return svc.real(x); }
wExtObj(1);

// K — class method (method delegation is always K; this-receiver also K).
class Holder {
  real(x: number): number { return x; }
  wThis(x: number): number { return this.real(x); }
  // K — even a param-receiver method is K (method guard precedes receiver gate).
  wParamMethod(p: Svc, x: number): number { return p.real(x); }
}
const h = new Holder();
h.wThis(1);
h.wParamMethod(svc, 1);
