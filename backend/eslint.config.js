import globals from 'globals';

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      // Catches `if (await foo)` where foo is a function reference, and other
      // await-shaped mistakes that silently return a Promise object.
      'require-await': 'off',
      'no-return-await': 'error',
    },
  },
  {
    ignores: ['node_modules/**', 'storage/**', 'coverage/**'],
  },
];
