import { describe, it, expect } from 'vitest';
import { agent } from '../agent';

describe('Agent avatar bindings', () => {
  it('getAvatarBindings returns empty object when no avatar configured', () => {
    const a = agent({ instructions: 'test' });
    const bindings = a.getAvatarBindings();
    expect(bindings).toEqual({});
    a.close();
  });

  it('getAvatarBindings returns default bindings when avatar enabled', () => {
    const a = agent({
      instructions: 'test',
      avatar: {
        enabled: true,
        runtimeMode: 'static_portrait',
        anchors: { neutralPortrait: 'https://example.com/face.png' },
      },
    });
    const bindings = a.getAvatarBindings();
    expect(bindings.speaking).toBe(false);
    expect(bindings.emotion).toBe('neutral');
    expect(bindings.intensity).toBe(0);
    expect(bindings.trust).toBe(0);
    a.close();
  });

  it('setAvatarBindingOverrides merges with auto-populated bindings', () => {
    const a = agent({
      instructions: 'test',
      avatar: {
        enabled: true,
        runtimeMode: 'static_portrait',
        anchors: { neutralPortrait: 'https://example.com/face.png' },
      },
    });
    a.setAvatarBindingOverrides({ healthBand: 'high', combatMode: true });
    const bindings = a.getAvatarBindings();
    expect(bindings.speaking).toBe(false);
    expect((bindings as any).healthBand).toBe('high');
    expect((bindings as any).combatMode).toBe(true);
    a.close();
  });

  it('setAvatarBindingOverrides overwrites previous overrides', () => {
    const a = agent({
      instructions: 'test',
      avatar: {
        enabled: true,
        runtimeMode: 'rive_rig',
        anchors: { neutralPortrait: 'https://example.com/face.png' },
      },
    });
    a.setAvatarBindingOverrides({ healthBand: 'high' });
    a.setAvatarBindingOverrides({ healthBand: 'low' });
    expect((a.getAvatarBindings() as any).healthBand).toBe('low');
    a.close();
  });
});
