import { describe, it, expect } from 'vitest';
import type {
  AvatarConfig,
  AvatarRuntimeMode,
  AvatarAnchorAssets,
  AvatarStyleProjection,
  AvatarDriftGuard,
  AvatarBindingInputs,
  AvatarRiveProfile,
  AvatarSpriteProfile,
  BaseAgentConfig,
} from '../types';

describe('AvatarConfig types', () => {
  it('accepts a minimal avatar config', () => {
    const config: AvatarConfig = {
      enabled: true,
      runtimeMode: 'static_portrait',
      anchors: {
        neutralPortrait: 'https://cdn.example.com/luna/neutral.png',
      },
    };
    expect(config.enabled).toBe(true);
    expect(config.runtimeMode).toBe('static_portrait');
    expect(config.anchors.neutralPortrait).toBeTruthy();
  });

  it('accepts a full avatar config with all optional fields', () => {
    const config: AvatarConfig = {
      enabled: true,
      runtimeMode: 'rive_rig',
      anchors: {
        neutralPortrait: 'https://cdn.example.com/luna/neutral.png',
        expressionSheet: 'https://cdn.example.com/luna/expressions.png',
        fullBody: 'https://cdn.example.com/luna/full.png',
        additionalPortraits: ['https://cdn.example.com/luna/happy.png'],
      },
      styleProjections: [
        {
          style: 'anime',
          anchors: { neutralPortrait: 'https://cdn.example.com/luna/anime.png' },
        },
      ],
      driftGuard: { faceSimilarity: 0.85, silhouetteSimilarity: 0.7, paletteSimilarity: 0.9 },
      riveProfile: {
        src: 'https://cdn.example.com/luna/rig.riv',
        artboard: 'LunaMain',
        stateMachine: 'LunaStateMachine',
        emotionInputMap: { emotion: 'mood', intensity: 'mood_intensity' },
        lipSyncMode: 'volume_reactive',
      },
    };
    expect(config.styleProjections).toHaveLength(1);
    expect(config.driftGuard?.faceSimilarity).toBe(0.85);
    expect(config.riveProfile?.artboard).toBe('LunaMain');
  });

  it('accepts avatar on BaseAgentConfig', () => {
    const agentConfig: Partial<BaseAgentConfig> = {
      name: 'Luna',
      avatar: {
        enabled: true,
        runtimeMode: 'static_portrait',
        anchors: { neutralPortrait: 'https://example.com/luna.png' },
      },
    };
    expect(agentConfig.avatar?.enabled).toBe(true);
  });

  it('accepts all runtime modes', () => {
    const modes: AvatarRuntimeMode[] = [
      'static_portrait', 'sprite_sheet', 'rive_rig',
      'live2d_rig', 'spine_rig', 'video_loop', 'phaser_sprite_actor',
    ];
    expect(modes).toHaveLength(7);
  });

  it('typing AvatarBindingInputs works with partial data', () => {
    const bindings: AvatarBindingInputs = {
      speaking: true,
      emotion: 'happy',
      intensity: 0.8,
    };
    expect(bindings.speaking).toBe(true);
    expect(bindings.trust).toBeUndefined();
  });
});
