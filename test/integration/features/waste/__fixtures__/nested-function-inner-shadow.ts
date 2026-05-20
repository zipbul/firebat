// case 1 (closure-capture 알고리즘 검증): outer `x = 1`은 dead-store-overwrite여야 한다.
// nested function `g` 안의 inner `let x = 2`는 *별개 binding* (다른 declScope) — outer x를
// closure로 capture하는 것이 아니다. 이름만 비교하던 옛 detector는 이 케이스를 false negative.
// bindingKey(name, declScope) 기반 capture 분석으로만 정확히 처리된다.

export function f(): number {
  let x = 1;

  function g(): number {
    let x = 2;

    return x;
  }

  x = 3;

  return x + g();
}
