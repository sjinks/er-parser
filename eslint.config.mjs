import MyrotvoretsConfig from '@myrotvorets/eslint-config-myrotvorets-ts';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        ignores: ['.tsimp/**', 'dist/**'],
    },
    ...MyrotvoretsConfig,
];
