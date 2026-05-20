// KEEP boundary: `export { foo }` specifier 형식도 export binding 비대상.
// foo의 declaration은 별도 statement이고 ExportNamedDeclaration의 declaration은 null.
// specifier의 local 식별자 이름으로 module-scope binding을 매칭하여 면제.

let foo = 1;
foo = 2;

export { foo };
