// @ts-check
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // Типизированный анализ: без него не работают правила про промисы, а в
      // проекте есть намеренные `void promise` (logger, login) — именно они и
      // страхуют, что где-то ещё промис не потеряется молча. Проект указан
      // явно: tsconfig.typecheck.json включает тесты, основной их исключает.
      parserOptions: {
        project: ['./tsconfig.typecheck.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',

      // Берём не весь recommendedTypeChecked, а то, что ловит реальные ошибки
      // в асинхронном коде. Осознанно НЕ включены:
      //   • no-unsafe-* — ответы Moodle типизированы как unknown, шум на каждом туле;
      //   • require-await — `execute` обязан быть async по контракту ToolDef
      //     (и моки в тестах тоже), поэтому правило ловит контракт, а не ошибки.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    },
  },

  prettier,
);
