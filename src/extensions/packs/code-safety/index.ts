import type { ExtensionPack, ExtensionPackContext } from '../../manifest';
import { EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_TOOL } from '../../types';
import type { CodeSafetyPackOptions, ICodeSafetyRule } from './types';
import { DEFAULT_SEVERITY_ACTIONS } from './types';
import { DEFAULT_RULES } from './DefaultRules';
import { CodeSafetyScanner } from './CodeSafetyScanner';
import { CodeSafetyGuardrail } from './CodeSafetyGuardrail';
import { ScanCodeTool } from './tools/ScanCodeTool';

export function createCodeSafetyPack(options?: CodeSafetyPackOptions): ExtensionPack {
  const opts = options ?? {};
  const rules = buildRuleSet(opts);
  const severityActions = { ...DEFAULT_SEVERITY_ACTIONS, ...opts.severityActions };
  const scanner = new CodeSafetyScanner(rules, severityActions);
  const guardrail = new CodeSafetyGuardrail(opts, scanner);
  const tool = new ScanCodeTool(scanner);

  // Plain descriptors (not getter) — intentional. No lifecycle needed.
  return {
    name: 'code-safety',
    version: '1.0.0',
    descriptors: [
      { id: 'code-safety-guardrail', kind: EXTENSION_KIND_GUARDRAIL, priority: 4, payload: guardrail },
      { id: 'scan_code', kind: EXTENSION_KIND_TOOL, priority: 0, payload: tool },
    ],
  };
}

export function createExtensionPack(context: ExtensionPackContext): ExtensionPack {
  return createCodeSafetyPack(context.options as CodeSafetyPackOptions);
}

function buildRuleSet(opts: CodeSafetyPackOptions): ICodeSafetyRule[] {
  let rules = opts.includeDefaultRules !== false ? [...DEFAULT_RULES] : [];
  if (opts.disabledRules?.length) {
    const disabled = new Set(opts.disabledRules);
    rules = rules.filter(r => !disabled.has(r.id));
  }
  if (opts.customRules?.length) rules.push(...opts.customRules);
  return rules;
}

export * from './types';
