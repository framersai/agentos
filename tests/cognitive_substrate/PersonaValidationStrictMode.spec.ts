import { describe, it, expect } from 'vitest';
import { IPersonaDefinition } from '../../src/cognitive_substrate/personas/IPersonaDefinition.js';
import { 
  validatePersonas, 
  classifyPersonaStrict, 
  applyStrictMode,
  PersonaValidationStrictConfig 
} from '../../src/cognitive_substrate/personas/PersonaValidation.js';

function makeBasePersona(overrides: Partial<IPersonaDefinition> = {}): IPersonaDefinition {
  return {
    id: 'persona-test',
    name: 'Test',
    description: 'Test persona',
    version: '1.0.0',
    baseSystemPrompt: 'You are helpful.',
    toolIds: ['searchWeb'],
    allowedOutputModalities: ['text'],
    ...overrides
  } as IPersonaDefinition;
}

describe('PersonaValidationStrictMode', () => {
  it('classifies persona as valid when strict mode disabled', async () => {
    const p = makeBasePersona({ version: 'bad' });
    const res = await validatePersonas([p]);
    const classification = classifyPersonaStrict(res.results[0], { enabled: false });
    expect(classification.status).toBe('valid');
    expect(classification.blockedReasons).toEqual([]);
  });

  it('classifies persona as valid in shadow mode even with errors', async () => {
    const p = makeBasePersona({ version: 'bad' });
    const res = await validatePersonas([p]);
    const classification = classifyPersonaStrict(res.results[0], { enabled: true, shadowMode: true });
    expect(classification.status).toBe('valid');
  });

  it('classifies persona as invalid when errors exist and strict mode active', async () => {
    const p = makeBasePersona({ version: 'bad' });
    const res = await validatePersonas([p]);
    const classification = classifyPersonaStrict(res.results[0], { enabled: true, shadowMode: false });
    expect(classification.status).toBe('invalid');
    expect(classification.blockedReasons).toContain('invalid_semver');
  });

  it('allows persona via allowlist even with errors', async () => {
    const p = makeBasePersona({ id: 'proto_experiment', version: 'bad' });
    const res = await validatePersonas([p]);
    const classification = classifyPersonaStrict(res.results[0], { 
      enabled: true, 
      shadowMode: false,
      allowlistPersonaIds: ['proto_experiment']
    });
    expect(classification.status).toBe('valid');
  });

  it('blocks on specific codes when blockOnCodes set', async () => {
    const p = makeBasePersona(); // valid persona
    const p2 = makeBasePersona({ id: 'p2', voiceConfig: { voiceId: 'v1' } }); // triggers warning
    const res = await validatePersonas([p, p2]);
    
    // Block only on voice_config_without_audio_output warning
    const classification = classifyPersonaStrict(res.results[1], { 
      enabled: true, 
      shadowMode: false,
      blockOnCodes: ['voice_config_without_audio_output']
    });
    expect(classification.status).toBe('invalid');
    expect(classification.blockedReasons).toContain('voice_config_without_audio_output');
  });

  it('escalates warnings to errors via treatWarningsAsErrors', async () => {
    const p = makeBasePersona({ voiceConfig: { voiceId: 'v1' } }); // warning only
    const res = await validatePersonas([p]);
    
    // Without escalation: should be degraded (has warning but not error)
    const classification1 = classifyPersonaStrict(res.results[0], { enabled: true, shadowMode: false });
    expect(classification1.status).toBe('degraded');
    
    // With escalation: should be invalid
    const classification2 = classifyPersonaStrict(res.results[0], { 
      enabled: true, 
      shadowMode: false,
      treatWarningsAsErrors: ['voice_config_without_audio_output']
    });
    expect(classification2.status).toBe('invalid');
  });

  it('marks persona degraded when warnings exist without blocking', async () => {
    const p = makeBasePersona({ voiceConfig: { voiceId: 'v1' } }); // warning only
    const res = await validatePersonas([p]);
    const classification = classifyPersonaStrict(res.results[0], { enabled: true, shadowMode: false });
    expect(classification.status).toBe('degraded');
    expect(classification.blockedReasons).toEqual([]);
  });

  it('applyStrictMode produces LoadedPersonaRecord array with correct statuses', async () => {
    const p1 = makeBasePersona({ id: 'p1' }); // valid
    const p2 = makeBasePersona({ id: 'p2', version: 'bad' }); // invalid
    const p3 = makeBasePersona({ id: 'p3', voiceConfig: { voiceId: 'v1' } }); // degraded
    
    const res = await validatePersonas([p1, p2, p3]);
    const strictConfig: PersonaValidationStrictConfig = { enabled: true, shadowMode: false };
    const records = applyStrictMode([p1, p2, p3], res.results, strictConfig);
    
    expect(records[0].status).toBe('valid');
    expect(records[1].status).toBe('invalid');
    expect(records[1].blockedReasons).toContain('invalid_semver');
    expect(records[2].status).toBe('degraded');
  });

  it('applyStrictMode in shadow mode marks all as valid', async () => {
    const p1 = makeBasePersona({ id: 'p1' }); // valid
    const p2 = makeBasePersona({ id: 'p2', version: 'bad' }); // would be invalid
    
    const res = await validatePersonas([p1, p2]);
    const strictConfig: PersonaValidationStrictConfig = { enabled: true, shadowMode: true };
    const records = applyStrictMode([p1, p2], res.results, strictConfig);
    
    expect(records[0].status).toBe('valid');
    expect(records[1].status).toBe('valid'); // shadow mode does not enforce
  });

  it('handles multiple blocking reasons', async () => {
    const p = makeBasePersona({ 
      version: 'bad', 
      defaultLanguage: 'english',
      toolIds: ['unknownTool', 'unknownTool'] // duplicate + unknown
    });
    const res = await validatePersonas([p], { knownToolIds: new Set(['searchWeb']) });
    const classification = classifyPersonaStrict(res.results[0], { enabled: true, shadowMode: false });
    
    expect(classification.status).toBe('invalid');
    expect(classification.blockedReasons?.length).toBeGreaterThan(1);
    expect(classification.blockedReasons).toContain('invalid_semver');
    expect(classification.blockedReasons).toContain('invalid_bcp47_language');
  });
});
