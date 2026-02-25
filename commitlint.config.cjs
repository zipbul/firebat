/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'scope-case': [2, 'always', ['kebab-case']],
    'scope-enum': [2, 'always', ['cli', 'mcp', 'lint', 'repo', 'config', 'scripts', 'agents', 'duplicates']],
    'type-enum': [2, 'always', ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test']],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'subject-full-stop': [2, 'never', '.'],
  },
};
