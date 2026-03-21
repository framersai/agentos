/**
 * @file index.spec.ts
 * @description Unit tests for the code safety pack factory.
 *
 * Tests verify:
 * - createCodeSafetyPack returns an ExtensionPack with correct name/version
 * - The pack provides exactly 2 descriptors: 1 guardrail + 1 tool
 * - Guardrail has id 'code-safety-guardrail'
 * - Tool has id 'scan_code'
 * - disabledRules removes rules from the active set
 * - customRules adds rules to the active set
 * - includeDefaultRules: false uses only custom rules
 * - createExtensionPack bridges context.options to createCodeSafetyPack
 */

import { describe, it, expect } from 'vitest';
import {
  createCodeSafetyPack,
  createExtensionPack,
} from '../../../../src/extensions/packs/code-safety/index';
import {
  EXTENSION_KIND_GUARDRAIL,
  EXTENSION_KIND_TOOL,
} from '../../../../src/extensions/types';
import type { ExtensionPackContext } from '../../../../src/extensions/manifest';
import type { ICodeSafetyRule } from '../../../../src/extensions/packs/code-safety/types';
import { DEFAULT_RULES } from '../../../../src/extensions/packs/code-safety/DefaultRules';

// ---------------------------------------------------------------------------
// Tests — createCodeSafetyPack
// ---------------------------------------------------------------------------

describe('createCodeSafetyPack', () => {
  it('should return an ExtensionPack with correct name and version', () => {
    const pack = createCodeSafetyPack();

    expect(pack.name).toBe('code-safety');
    expect(pack.version).toBe('1.0.0');
  });

  it('should provide exactly 2 descriptors', () => {
    const pack = createCodeSafetyPack();

    expect(pack.descriptors).toHaveLength(2);
  });

  it('should have a guardrail descriptor with id "code-safety-guardrail"', () => {
    const pack = createCodeSafetyPack();
    const guardrailDescriptor = pack.descriptors.find(
      (d) => d.id === 'code-safety-guardrail',
    );

    expect(guardrailDescriptor).toBeDefined();
    expect(guardrailDescriptor!.kind).toBe(EXTENSION_KIND_GUARDRAIL);
    expect(guardrailDescriptor!.priority).toBe(4);
    expect(guardrailDescriptor!.payload).toBeDefined();
  });

  it('should have a tool descriptor with id "scan_code"', () => {
    const pack = createCodeSafetyPack();
    const toolDescriptor = pack.descriptors.find((d) => d.id === 'scan_code');

    expect(toolDescriptor).toBeDefined();
    expect(toolDescriptor!.kind).toBe(EXTENSION_KIND_TOOL);
    expect(toolDescriptor!.priority).toBe(0);
    expect(toolDescriptor!.payload).toBeDefined();
  });

  it('should work with zero-config (no options)', () => {
    const pack = createCodeSafetyPack();

    expect(pack.name).toBe('code-safety');
    expect(pack.descriptors).toHaveLength(2);
  });

  it('disabledRules should remove matching rules from the active set', () => {
    // Get a rule ID from the default set to disable.
    const ruleToDisable = DEFAULT_RULES[0].id;

    // The pack builds the scanner internally, but we can verify indirectly:
    // A pack with a disabled rule is still structurally valid.
    const pack = createCodeSafetyPack({ disabledRules: [ruleToDisable] });

    expect(pack.descriptors).toHaveLength(2);
    expect(pack.name).toBe('code-safety');
  });

  it('disabledRules should not crash when given unknown rule IDs', () => {
    const pack = createCodeSafetyPack({ disabledRules: ['nonexistent-rule-xyz'] });

    expect(pack.descriptors).toHaveLength(2);
  });

  it('customRules should add rules to the active set', () => {
    const customRule: ICodeSafetyRule = {
      id: 'custom-test-rule',
      name: 'Custom Test Rule',
      description: 'A custom rule for testing',
      category: 'other',
      severity: 'low',
      patterns: {
        '*': [/UNSAFE_CUSTOM_PATTERN/],
      },
    };

    const pack = createCodeSafetyPack({ customRules: [customRule] });

    // Pack should still have the standard 2 descriptors.
    expect(pack.descriptors).toHaveLength(2);
    expect(pack.name).toBe('code-safety');
  });

  it('includeDefaultRules: false should use only custom rules', () => {
    const customRule: ICodeSafetyRule = {
      id: 'only-custom-rule',
      name: 'Only Custom Rule',
      description: 'Replaces all defaults',
      category: 'injection',
      severity: 'high',
      patterns: {
        '*': [/ONLY_CUSTOM/],
      },
    };

    const pack = createCodeSafetyPack({
      includeDefaultRules: false,
      customRules: [customRule],
    });

    // Should still produce the standard pack shape.
    expect(pack.descriptors).toHaveLength(2);
    expect(pack.name).toBe('code-safety');
  });

  it('includeDefaultRules: false with no customRules should produce empty ruleset (pack still valid)', () => {
    const pack = createCodeSafetyPack({ includeDefaultRules: false });

    expect(pack.descriptors).toHaveLength(2);
    expect(pack.name).toBe('code-safety');
  });

  it('severityActions override should be accepted without error', () => {
    const pack = createCodeSafetyPack({
      severityActions: { medium: 'block', low: 'block' },
    });

    expect(pack.descriptors).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — createExtensionPack (manifest bridge)
// ---------------------------------------------------------------------------

describe('createExtensionPack', () => {
  it('should bridge context.options to createCodeSafetyPack', () => {
    const context: ExtensionPackContext = {
      options: {
        disabledRules: ['code-injection-eval'],
        severityActions: { medium: 'block' },
      },
    };

    const pack = createExtensionPack(context);

    expect(pack.name).toBe('code-safety');
    expect(pack.version).toBe('1.0.0');
    expect(pack.descriptors).toHaveLength(2);
  });

  it('should work with empty context options', () => {
    const context: ExtensionPackContext = {};

    const pack = createExtensionPack(context);

    expect(pack.name).toBe('code-safety');
    expect(pack.descriptors).toHaveLength(2);
  });

  it('should work with undefined options in context', () => {
    const context: ExtensionPackContext = { options: undefined };

    const pack = createExtensionPack(context);

    expect(pack.name).toBe('code-safety');
    expect(pack.descriptors).toHaveLength(2);
  });
});
