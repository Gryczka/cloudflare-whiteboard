import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['dist', 'node_modules', 'worker-configuration.d.ts', '**/*.d.ts'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			parserOptions: { project: ['./tsconfig.json', './test/tsconfig.json'] },
		},
		plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
		rules: {
			...reactHooks.configs.recommended.rules,
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
			'@typescript-eslint/no-floating-promises': 'error',
		},
	},
	{
		files: ['src/client/main.tsx'],
		rules: { 'react-refresh/only-export-components': 'off' },
	},
);
