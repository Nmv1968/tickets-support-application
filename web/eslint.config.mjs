// @ts-check
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.angular/', 'dist/', 'out-tsc/', 'coverage/'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      angular.configs.tsRecommended,
    ],
    // Inline templates are linted with the rules for HTML below.
    processor: angular.processInlineTemplates,
    rules: {
      // Components are elements. A few style a native element and are attributes on it
      // (`button[appReminderCard]`, `span[appStatusBadge]`).
      '@angular-eslint/component-selector': [
        'error',
        [
          { type: 'element', prefix: 'app', style: 'kebab-case' },
          { type: 'attribute', prefix: 'app', style: 'camelCase' },
        ],
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      // How this code is written: OnPush everywhere (the app is zoneless), signal inputs, queries
      // and outputs, standalone components, inject(), and `host` instead of host decorators.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // @if, @for and @switch instead of *ngIf, *ngFor and ngSwitch. `@for` requires `track`, so
      // use-track-by-function is not needed.
      '@angular-eslint/template/prefer-control-flow': 'error',
      // A button without a type submits the form it is in.
      '@angular-eslint/template/button-has-type': 'error',
      // ReminderCard is a component on a <button> and draws its content (case, reason, detail).
      '@angular-eslint/template/elements-content': ['error', { allowList: ['appReminderCard'] }],
    },
  },
);
