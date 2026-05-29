/**
 * @fileoverview Tests for the full train -> classify -> save -> load -> classify
 * lifecycle of the StatisticalUtilityAI Naive Bayes classifier.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StatisticalUtilityAI } from '../StatisticalUtilityAI';

let util: StatisticalUtilityAI;
let tmpDir: string | undefined;

const trainingData = [
  { text: 'swing sword at the goblin', label: 'attack' },
  { text: 'slash the orc with my axe', label: 'attack' },
  { text: 'shoot an arrow at the dragon', label: 'attack' },
  { text: 'stab the skeleton with a dagger', label: 'attack' },
  { text: 'put on the leather armor', label: 'equip' },
  { text: 'equip the magic staff', label: 'equip' },
  { text: 'wear the enchanted ring', label: 'equip' },
  { text: 'wield the great hammer', label: 'equip' },
  { text: 'purchase a healing potion from the merchant', label: 'buy' },
  { text: 'buy supplies at the shop', label: 'buy' },
  { text: 'trade gold for a shield', label: 'buy' },
  { text: 'pay the blacksmith for repairs', label: 'buy' },
];

beforeEach(async () => {
  util = new StatisticalUtilityAI('test-stat');
  await util.initialize({ utilityId: 'test-stat', defaultLanguage: 'en' });
  tmpDir = undefined;
});

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('trainModel -> classifyText lifecycle', () => {
  it('trains with game action data then classifies successfully', async () => {
    const trainResult = await util.trainModel(trainingData, 'text_classifier_naive_bayes', {
      modelId: 'rpg-lifecycle',
    });
    expect(trainResult.success).toBe(true);
    expect(trainResult.modelId).toBe('rpg-lifecycle');

    const classify = await util.classifyText('hit the troll with my mace', {
      candidateClasses: ['attack', 'equip', 'buy'],
      method: 'naive_bayes',
      modelId: 'rpg-lifecycle',
    });
    expect(classify.bestClass).toBeDefined();
    expect(typeof classify.confidence).toBe('number');
    expect(Array.isArray(classify.allScores)).toBe(true);
  });

  it('classifies attack, equip, and buy inputs after training', async () => {
    await util.trainModel(trainingData, 'text_classifier_naive_bayes', {
      modelId: 'rpg-lifecycle',
    });

    const attack = await util.classifyText('attack the beast with a longsword', {
      candidateClasses: ['attack', 'equip', 'buy'],
      method: 'naive_bayes',
      modelId: 'rpg-lifecycle',
    });
    expect(attack.bestClass).toBe('attack');

    const equip = await util.classifyText('put on the heavy plate armor', {
      candidateClasses: ['attack', 'equip', 'buy'],
      method: 'naive_bayes',
      modelId: 'rpg-lifecycle',
    });
    expect(equip.bestClass).toBe('equip');

    const buy = await util.classifyText('buy a new sword from the merchant shop', {
      candidateClasses: ['attack', 'equip', 'buy'],
      method: 'naive_bayes',
      modelId: 'rpg-lifecycle',
    });
    expect(buy.bestClass).toBe('buy');
  });
});

describe('save -> load -> classify lifecycle', () => {
  it('saves trained model, loads into new instance, classifies with loaded model', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stat-nb-'));

    // Train and save
    await util.trainModel(trainingData, 'text_classifier_naive_bayes', {
      modelId: 'rpg-save-load',
    });
    const savePath = path.join(tmpDir, 'rpg-save-load.nbc.json');
    const saveResult = await util.saveTrainedModel('rpg-save-load', 'text_classifier_naive_bayes', savePath);
    expect(saveResult.success).toBe(true);
    expect(fs.existsSync(savePath)).toBe(true);

    // Create fresh instance and load
    const util2 = new StatisticalUtilityAI('test-stat-2');
    await util2.initialize({ utilityId: 'test-stat-2', defaultLanguage: 'en' });
    const loadResult = await util2.loadTrainedModel('rpg-save-load', 'text_classifier_naive_bayes', savePath);
    expect(loadResult.success).toBe(true);

    // Classify with loaded model
    const classify = await util2.classifyText('swing my hammer at the wolf', {
      candidateClasses: ['attack', 'equip', 'buy'],
      method: 'naive_bayes',
      modelId: 'rpg-save-load',
    });
    expect(classify.bestClass).toBeDefined();
    expect(classify.allScores.length).toBeGreaterThanOrEqual(1);
  });
});

describe('error handling', () => {
  it('saveTrainedModel returns { success: false } when no model has been trained', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stat-nb-'));
    const savePath = path.join(tmpDir, 'nonexistent.nbc.json');
    const saveResult = await util.saveTrainedModel('nonexistent-model', 'text_classifier_naive_bayes', savePath);
    expect(saveResult.success).toBe(false);
  });

  it('loadTrainedModel returns { success: false } for nonexistent path', async () => {
    const loadResult = await util.loadTrainedModel('ghost-model', 'text_classifier_naive_bayes', '/tmp/does-not-exist-abc123.nbc.json');
    expect(loadResult.success).toBe(false);
  });

  it('trainModel returns { success: false } for unsupported model type', async () => {
    const result = await util.trainModel(trainingData, 'unsupported_model_type');
    expect(result.success).toBe(false);
  });
});
