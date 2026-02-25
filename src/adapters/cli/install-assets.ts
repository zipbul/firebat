import * as path from 'node:path';

const OXLINT_RC_JSONC = `{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["unicorn", "typescript", "oxc", "import", "promise", "node", "jsdoc", "jest"],
  "jsPlugins": ["firebat/oxlint-plugin"],
  "rules": {
    "unicorn/no-new-array": "off",
    "unicorn/no-null": "off",
    "unicorn/no-useless-undefined": "off",
    "constructor-super": "error",
    "for-direction": "error",
    "no-async-promise-executor": "error",
    "no-caller": "error",
    "no-class-assign": "error",
    "no-compare-neg-zero": "error",
    "no-cond-assign": "error",
    "no-const-assign": "error",
    "no-constant-binary-expression": "error",
    "no-constant-condition": "error",
    "no-control-regex": "error",
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-dupe-class-members": "error",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "error",
    "no-duplicate-case": "error",
    "no-empty-pattern": "error",
    "no-ex-assign": "error",
    "no-extra-boolean-cast": "error",
    "no-func-assign": "error",
    "no-global-assign": "error",
    "no-import-assign": "error",
    "no-invalid-regexp": "error",
    "no-irregular-whitespace": "error",
    "no-loss-of-precision": "error",
    "no-new-native-nonconstructor": "error",
    "no-obj-calls": "error",
    "no-self-assign": "error",
    "no-setter-return": "error",
    "no-sparse-arrays": "error",
    "no-this-before-super": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unsafe-optional-chaining": "error",
    "no-useless-backreference": "error",
    "no-useless-catch": "error",
    "no-useless-escape": "error",
    "no-useless-rename": "error",
    "no-with": "error",
    "no-empty": [
      "error",
      {
        "allowEmptyCatch": true
      }
    ],
    "no-unused-expressions": "error",
    "no-empty-function": [
      "error",
      {
        "allow": ["arrowFunctions"]
      }
    ],
    "curly": "error",
    "no-else-return": "error",
    "no-unneeded-ternary": "error",
    "default-case": "error",
    "default-case-last": "error",
    "default-param-last": "error",
    "no-self-compare": "error",
    "no-loop-func": "error",
    "typescript/no-empty-object-type": [
      "error",
      {
        "allowInterfaces": "always"
      }
    ],
    "typescript/await-thenable": "error",
    "typescript/no-array-delete": "error",
    "typescript/no-base-to-string": "error",
    "typescript/no-confusing-void-expression": "error",
    "typescript/no-deprecated": "error",
    "typescript/no-duplicate-type-constituents": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-for-in-array": "error",
    "typescript/no-meaningless-void-operator": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-misused-spread": "error",
    "typescript/no-mixed-enums": "error",
    "typescript/no-unnecessary-boolean-literal-compare": "error",
    "typescript/no-unnecessary-condition": "error",
    "typescript/no-unnecessary-template-expression": "error",
    "typescript/no-unnecessary-type-arguments": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unnecessary-type-parameters": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-unary-minus": "error",
    "typescript/non-nullable-type-assertion-style": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-includes": "error",
    "typescript/prefer-literal-enum-member": "error",
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-reduce-type-parameter": "error",
    "typescript/prefer-regexp-exec": "error",
    "typescript/prefer-return-this-type": "error",
    "typescript/promise-function-async": "error",
    "typescript/require-array-sort-compare": "error",
    "typescript/restrict-plus-operands": "error",
    "typescript/restrict-template-expressions": "error",
    "typescript/return-await": "error",
    "typescript/strict-boolean-expressions": "off",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/unified-signatures": "error",
    "typescript/no-explicit-any": "off",
    "typescript/no-unused-vars": "off",
    "typescript/no-var-requires": "error",
    "typescript/no-unsafe-function-type": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-optional-chaining": "off",
    "typescript/no-unsafe-enum-comparison": "off",
    "typescript/no-unsafe-property-access": "off",
    "typescript/no-unsafe-return": "off",
    "typescript/no-unsafe-call": "off",
    "typescript/no-unsafe-member-access": "off",
    "typescript/no-unsafe-argument": "off",
    "typescript/no-unsafe-unary-minus": "off",
    "typescript/no-non-null-assertion": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-unsafe-declaration-merging": "off",
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-unsafe-member-access": "off",
    "typescript/no-unsafe-return": "off",
    "typescript/no-unsafe-call": "off",
    "typescript/no-unsafe-argument": "off",
    "typescript/no-unsafe-assignment": "off"
  }
}
`;

interface LoadedTextFile {
  readonly filePath: string;
  readonly text: string;
}

const failLoadText = (message: string): never => {
  throw new Error(message);
};

const loadFirstExistingText = async (candidates: ReadonlyArray<string>): Promise<LoadedTextFile> => {
  if (candidates.length === 0) {
    return failLoadText('[firebat] No asset candidates provided. Ensure the firebat package includes assets/.');
  }

  for (const filePath of candidates) {
    try {
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        continue;
      }

      return { filePath, text: await file.text() };
    } catch {
      continue;
    }
  }

  return failLoadText('[firebat] Could not locate packaged assets/. Ensure the firebat package includes assets/.');
};

const resolveAssetCandidates = (assetFileName: string): string[] => {
  // Works in both repo (src/* sibling to assets/*) and published package (dist/* sibling to assets/*)
  return [
    path.resolve(import.meta.dir, '../../../assets', assetFileName),
    path.resolve(import.meta.dir, '../../assets', assetFileName),
    path.resolve(import.meta.dir, '../assets', assetFileName),
    path.resolve(process.cwd(), 'assets', assetFileName),
  ];
};

const OXFMT_RC_JSONC = `{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",

  "printWidth": 130,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "jsxSingleQuote": false,
  "quoteProps": "as-needed",
  "trailingComma": "all",
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "avoid",
  "proseWrap": "preserve",
  "embeddedLanguageFormatting": "auto",
  "endOfLine": "lf",
  "insertFinalNewline": true,
  "ignorePatterns": [],
  "experimentalSortPackageJson": {
    "sortScripts": true
  },
  "experimentalSortImports": {
    "customGroups": [],
    "groups": [
      "type-import",
      ["value-builtin", "value-external"],
      "type-internal",
      "value-internal",
      ["type-parent", "type-sibling", "type-index"],
      ["value-parent", "value-sibling", "value-index"],
      "unknown"
    ],
    "ignoreCase": true,
    "internalPattern": ["~/", "@/"],
    "newlinesBetween": true,
    "order": "asc",
    "partitionByComment": false,
    "partitionByNewline": false,
    "sortSideEffects": false
  }
  };

`;

export { OXLINT_RC_JSONC, OXFMT_RC_JSONC, loadFirstExistingText, resolveAssetCandidates };
