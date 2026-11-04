import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'YTL_TrackA_Udyam_Digital_Data/**',
    '6ad9d4887d445_airtel_sync/**',
    '__MACOSX/**',
    '.claude/**',
  ]),
  {
    // Keeps the dependency direction in CLAUDE.md enforceable: domain logic stays pure.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*', '@/server/*', '@/components/*', 'next', 'next/*', 'react', 'react-dom'],
              message: 'src/domain must not import framework, server or UI code.',
            },
            {
              group: ['node:*', 'fs', 'path', 'drizzle-orm', 'drizzle-orm/*', '@libsql/*'],
              message: 'src/domain must not touch files or the database.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use Clock from src/lib for the current time, not new Date().',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Use Clock from src/lib for the current time, not Date.now().',
        },
      ],
    },
  },
]);
