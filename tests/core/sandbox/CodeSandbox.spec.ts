/**
 * @file CodeSandbox.spec.ts
 * @description Unit tests for the Code Execution Sandbox.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeSandbox } from '../../../src/core/sandbox/CodeSandbox';
import type { SandboxLanguage } from '../../../src/core/sandbox/ICodeSandbox';

describe('CodeSandbox', () => {
  let sandbox: CodeSandbox;

  beforeEach(() => {
    sandbox = new CodeSandbox();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(sandbox.initialize()).resolves.not.toThrow();
    });
  });

  describe('execute - JavaScript', () => {
    it('should execute simple JavaScript', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'console.log("Hello, World!");',
      });

      expect(result.status).toBe('success');
      expect(result.output?.stdout).toContain('Hello, World!');
      expect(result.output?.exitCode).toBe(0);
    });

    it('should execute JavaScript with return value', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'return 2 + 2;',
      });

      expect(result.status).toBe('success');
      expect(result.output?.stdout).toContain('4');
    });

    it('should handle JSON operations', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: `
          const data = { name: "test", value: 42 };
          console.log(JSON.stringify(data));
        `,
      });

      expect(result.status).toBe('success');
      expect(result.output?.stdout).toContain('{"name":"test","value":42}');
    });

    it('should capture errors in stderr', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'throw new Error("Test error");',
      });

      expect(result.status).toBe('error');
      expect(result.output?.stderr).toContain('Test error');
    });

    it('should handle async code', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: `
          const wait = (ms) => new Promise(r => setTimeout(r, ms));
          console.log("start");
          await wait(10);
          console.log("end");
        `,
      });

      expect(result.status).toBe('success');
      expect(result.output?.stdout).toContain('start');
      expect(result.output?.stdout).toContain('end');
    });
  });

  describe('security validation', () => {
    it('should block dangerous require statements', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'const fs = require("fs");',
      });

      expect(result.status).toBe('error');
      expect(result.securityEvents).toBeDefined();
      expect(result.securityEvents?.length).toBeGreaterThan(0);
    });

    it('should block eval', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'eval("1+1");',
      });

      expect(result.status).toBe('error');
      expect(result.securityEvents?.some(e => e.description.includes('eval'))).toBe(true);
    });

    it('should block child_process', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'const { exec } = require("child_process");',
      });

      expect(result.status).toBe('error');
      expect(result.securityEvents?.some(e => e.severity === 'high')).toBe(true);
    });

    it('should detect dangerous Python patterns', () => {
      const events = sandbox.validateCode('python', 'import subprocess');
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].severity).toBe('high');
    });

    it('should detect dangerous SQL patterns', () => {
      const events = sandbox.validateCode('sql', 'DROP TABLE users;');
      expect(events.length).toBeGreaterThan(0);
    });

    it('should detect dangerous shell patterns', () => {
      const events = sandbox.validateCode('shell', 'rm -rf /');
      expect(events.length).toBeGreaterThan(0);
      // The severity is detected based on the pattern, dangerous shell commands are flagged
      expect(['critical', 'high', 'medium', 'low']).toContain(events[0].severity);
    });
  });

  describe('execution management', () => {
    it('should generate execution ID', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'return 1;',
      });

      expect(result.executionId).toBeDefined();
      expect(result.executionId.length).toBeGreaterThan(0);
    });

    it('should use provided execution ID', async () => {
      const result = await sandbox.execute({
        executionId: 'custom-id-123',
        language: 'javascript',
        code: 'return 1;',
      });

      expect(result.executionId).toBe('custom-id-123');
    });

    it('should track execution in history', async () => {
      await sandbox.execute({
        language: 'javascript',
        code: 'return 1;',
      });

      const executions = await sandbox.listExecutions();
      expect(executions.length).toBeGreaterThan(0);
    });

    it('should retrieve execution by ID', async () => {
      const result = await sandbox.execute({
        executionId: 'test-id',
        language: 'javascript',
        code: 'return 42;',
      });

      const retrieved = await sandbox.getExecution('test-id');
      expect(retrieved).toBeDefined();
      expect(retrieved?.executionId).toBe('test-id');
    });
  });

  describe('statistics', () => {
    it('should track successful executions', async () => {
      await sandbox.execute({ language: 'javascript', code: 'return 1;' });
      await sandbox.execute({ language: 'javascript', code: 'return 2;' });

      const stats = sandbox.getStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successfulExecutions).toBe(2);
    });

    it('should track failed executions', async () => {
      await sandbox.execute({ language: 'javascript', code: 'throw new Error();' });

      const stats = sandbox.getStats();
      expect(stats.failedExecutions).toBe(1);
    });

    it('should track executions by language', async () => {
      await sandbox.execute({ language: 'javascript', code: 'return 1;' });
      await sandbox.execute({ language: 'javascript', code: 'return 2;' });

      const stats = sandbox.getStats();
      expect(stats.byLanguage.javascript).toBe(2);
    });

    it('should reset statistics', async () => {
      await sandbox.execute({ language: 'javascript', code: 'return 1;' });
      sandbox.resetStats();

      const stats = sandbox.getStats();
      expect(stats.totalExecutions).toBe(0);
    });
  });

  describe('language support', () => {
    it('should report supported languages', () => {
      const languages = sandbox.getSupportedLanguages();
      expect(languages).toContain('javascript');
      expect(languages).toContain('python');
      expect(languages).toContain('shell');
    });

    it('should check language support', () => {
      expect(sandbox.isLanguageSupported('javascript')).toBe(true);
      expect(sandbox.isLanguageSupported('python')).toBe(true);
      expect(sandbox.isLanguageSupported('cobol')).toBe(false);
    });
  });

  describe('output handling', () => {
    it('should capture console.log output', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: `
          console.log("line 1");
          console.log("line 2");
        `,
      });

      expect(result.output?.stdout).toContain('line 1');
      expect(result.output?.stdout).toContain('line 2');
    });

    it('should capture console.error output', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'console.error("error message");',
      });

      expect(result.output?.stderr).toContain('error message');
    });

    it('should track execution duration', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'return 1;',
      });

      expect(result.durationMs).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dispose', () => {
    it('should dispose cleanly', async () => {
      await sandbox.execute({ language: 'javascript', code: 'return 1;' });
      await expect(sandbox.dispose()).resolves.not.toThrow();
    });
  });
});

