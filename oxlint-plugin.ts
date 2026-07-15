import {
  blankLinesBetweenStatementGroupsRule,
  memberOrderingRule,
  noBracketNotationRule,
  noDynamicImportRule,
  noGlobalThisMutationRule,
  noInlineObjectTypeRule,
  noTombstoneRule,
  noUmbrellaTypesRule,
  noUnmodifiedLoopConditionRule,
  paddingLineBetweenStatementsRule,
  singleExportedClassRule,
  testDescribeSutNameRule,
  testUnitFileMappingRule,
  unusedImportsRule,
} from './src/oxlint-plugin/rules';

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
    'no-inline-object-type': noInlineObjectTypeRule,
    'no-bracket-notation': noBracketNotationRule,
    'no-dynamic-import': noDynamicImportRule,
    'no-globalthis-mutation': noGlobalThisMutationRule,
    'no-umbrella-types': noUmbrellaTypesRule,
    'single-exported-class': singleExportedClassRule,
    'test-describe-sut-name': testDescribeSutNameRule,
    'test-unit-file-mapping': testUnitFileMappingRule,
    'unused-imports': unusedImportsRule,
  },
};

export { plugin };
export default plugin;
