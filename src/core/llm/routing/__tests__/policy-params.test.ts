import { describe, it, expect } from 'vitest';
import type { ModelRouteParams } from '../IModelRouter';

describe('ModelRouteParams policy extensions', () => {
  it('accepts policyTier field', () => {
    const params: ModelRouteParams = {
      taskHint: 'companion_chat',
      policyTier: 'private-adult',
    };
    expect(params.policyTier).toBe('private-adult');
  });

  it('accepts contentIntent field', () => {
    const params: ModelRouteParams = {
      taskHint: 'narration',
      policyTier: 'mature',
      contentIntent: 'erotic',
    };
    expect(params.contentIntent).toBe('erotic');
  });

  it('remains optional — omitting policy fields compiles and works', () => {
    const params: ModelRouteParams = {
      taskHint: 'general_chat',
    };
    expect(params.policyTier).toBeUndefined();
    expect(params.contentIntent).toBeUndefined();
  });
});
