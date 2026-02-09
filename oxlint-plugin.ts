import { blankLinesBetweenStatementGroupsRule } from './src/oxlint-plugin/rules/blank-lines-between-statement-groups';
import { memberOrderingRule } from './src/oxlint-plugin/rules/member-ordering';
import { noBracketNotationRule } from './src/oxlint-plugin/rules/no-bracket-notation';
import { noDoubleAssertionRule } from './src/oxlint-plugin/rules/no-double-assertion';
import { noDynamicImportRule } from './src/oxlint-plugin/rules/no-dynamic-import';
import { noGlobalThisMutationRule } from './src/oxlint-plugin/rules/no-globalthis-mutation';
import { noInlineObjectTypeRule } from './src/oxlint-plugin/rules/no-inline-object-type';
import { noNonNullAssertionRule } from './src/oxlint-plugin/rules/no-non-null-assertion';
import { noTombstoneRule } from './src/oxlint-plugin/rules/no-tombstone';
import { noTsIgnoreRule } from './src/oxlint-plugin/rules/no-ts-ignore';
import { noUmbrellaTypesRule } from './src/oxlint-plugin/rules/no-umbrella-types';
import { noUnmodifiedLoopConditionRule } from './src/oxlint-plugin/rules/no-unmodified-loop-condition';
import { paddingLineBetweenStatementsRule } from './src/oxlint-plugin/rules/padding-line-between-statements';
import { singleExportedClassRule } from './src/oxlint-plugin/rules/single-exported-class';
import { testAaaCommentsRule } from './src/oxlint-plugin/rules/test-aaa-comments';
import { testBddTitleRule } from './src/oxlint-plugin/rules/test-bdd-title';
import { testDescribeSutNameRule } from './src/oxlint-plugin/rules/test-describe-sut-name';
import { testUnitFileMappingRule } from './src/oxlint-plugin/rules/test-unit-file-mapping';
import { unusedImportsRule } from './src/oxlint-plugin/rules/unused-imports';

const plugin = {
  meta: {
    name: 'firebat',
  },
  rules: {
    'blank-lines-between-statement-groups': blankLinesBetweenStatementGroupsRule,
    'member-ordering': memberOrderingRule,
    'padding-line-between-statements': paddingLineBetweenStatementsRule,
    'no-unmodified-loop-condition': noUnmodifiedLoopConditionRule,
    'no-tombstone': noTombstoneRule,
    'no-double-assertion': noDoubleAssertionRule,
    'no-non-null-assertion': noNonNullAssertionRule,
    'no-ts-ignore': noTsIgnoreRule,
    'no-inline-object-type': noInlineObjectTypeRule,
    'no-bracket-notation': noBracketNotationRule,
    'no-dynamic-import': noDynamicImportRule,
    'no-globalthis-mutation': noGlobalThisMutationRule,
    'no-umbrella-types': noUmbrellaTypesRule,
    'single-exported-class': singleExportedClassRule,
    'test-aaa-comments': testAaaCommentsRule,
    'test-bdd-title': testBddTitleRule,
    'test-describe-sut-name': testDescribeSutNameRule,
    'test-unit-file-mapping': testUnitFileMappingRule,
    'unused-imports': unusedImportsRule,
  },
};

export default plugin;
