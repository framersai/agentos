import { describe, it, expect, beforeEach } from 'vitest';
import { StatisticalUtilityAI, StatisticalUtilityAIConfig } from '../StatisticalUtilityAI';
import { IUtilityAI, LanguageDetectionResult } from '../IUtilityAI';
import {
  extractTrigrams,
  rankTrigrams,
  computeDistance,
  distancesToConfidences,
  detectLanguageTrigram,
  iso6393To1,
  getSupportedLanguages,
} from '../trigram-language-profiles';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENGLISH_PASSAGE =
  'The quick brown fox jumps over the lazy dog. This sentence contains ' +
  'every letter of the alphabet and is commonly used for testing purposes.';

const FRENCH_PASSAGE =
  "Tous les êtres humains naissent libres et égaux en dignité et en droits. " +
  "Ils sont doués de raison et de conscience et doivent agir les uns envers les autres dans un esprit de fraternité.";

const GERMAN_PASSAGE =
  'Alle Menschen sind frei und gleich an Würde und Rechten geboren. ' +
  'Sie sind mit Vernunft und Gewissen begabt und sollen einander im Geist der Brüderlichkeit begegnen.';

const SPANISH_PASSAGE =
  'Todos los seres humanos nacen libres e iguales en dignidad y derechos. ' +
  'Dotados como están de razón y conciencia, deben comportarse fraternalmente los unos con los otros.';

const PORTUGUESE_PASSAGE =
  'Todos os seres humanos nascem livres e iguais em dignidade e em direitos. ' +
  'Dotados de razão e de consciência, devem agir uns para com os outros num espírito de fraternidade.';

const ITALIAN_PASSAGE =
  'Tutti gli esseri umani nascono liberi e uguali in dignità e diritti. ' +
  'Essi sono dotati di ragione e di coscienza e devono agire gli uni verso gli altri in spirito di fratellanza.';

const DUTCH_PASSAGE =
  'Alle mensen worden vrij en gelijk in waardigheid en rechten geboren. ' +
  'Zij zijn begiftigd met verstand en geweten en behoren zich jegens elkander in een geest van broederschap te gedragen.';

const TURKISH_PASSAGE =
  'Bütün insanlar hür, haysiyet ve haklar bakımından eşit doğarlar. ' +
  'Akıl ve vicdana sahiptirler ve birbirlerine karşı kardeşlik zihniyeti ile hareket etmelidirler.';

const POLISH_PASSAGE =
  'Wszyscy ludzie rodzą się wolni i równi pod względem swej godności i swych praw. ' +
  'Są oni obdarzeni rozumem i sumieniem i powinni postępować wobec innych w duchu braterstwa.';

const SWEDISH_PASSAGE =
  'Alla människor äro födda fria och lika i värde och rättigheter. ' +
  'De äro utrustade med förnuft och samvete och böra handla gentemot varandra i en anda av broderskap.';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const defaultConfig: StatisticalUtilityAIConfig = {
  utilityId: 'test-lang-detect',
  defaultLanguage: 'en',
};

// ---------------------------------------------------------------------------
// Low-level trigram helpers
// ---------------------------------------------------------------------------

describe('trigram-language-profiles (low-level)', () => {
  describe('extractTrigrams', () => {
    it('returns a non-empty map for a normal string', () => {
      const counts = extractTrigrams('hello world');
      expect(counts.size).toBeGreaterThan(0);
    });

    it('includes word-boundary trigrams', () => {
      const counts = extractTrigrams('hello');
      // " he", "hel", "ell", "llo", "lo "
      expect(counts.has(' he')).toBe(true);
      expect(counts.has('lo ')).toBe(true);
    });

    it('lowercases text before extraction', () => {
      const counts = extractTrigrams('HELLO');
      expect(counts.has(' he')).toBe(true);
      expect(counts.has(' HE')).toBe(false);
    });

    it('returns empty map for empty string', () => {
      const counts = extractTrigrams('');
      expect(counts.size).toBe(0);
    });
  });

  describe('rankTrigrams', () => {
    it('orders trigrams by descending frequency', () => {
      const counts = new Map<string, number>([
        ['abc', 5],
        ['def', 10],
        ['ghi', 1],
      ]);
      const ranked = rankTrigrams(counts);
      expect(ranked[0]).toBe('def');
      expect(ranked[1]).toBe('abc');
      expect(ranked[2]).toBe('ghi');
    });

    it('respects maxRank', () => {
      const counts = new Map<string, number>([
        ['aaa', 3],
        ['bbb', 2],
        ['ccc', 1],
      ]);
      const ranked = rankTrigrams(counts, 2);
      expect(ranked).toHaveLength(2);
    });
  });

  describe('computeDistance', () => {
    it('returns 0 for identical profiles', () => {
      const profile = ['abc', 'def', 'ghi'];
      expect(computeDistance(profile, profile)).toBe(0);
    });

    it('returns higher distance for dissimilar profiles', () => {
      const a = ['abc', 'def', 'ghi'];
      const b = ['xyz', 'uvw', 'rst'];
      const same = computeDistance(a, a);
      const diff = computeDistance(a, b);
      expect(diff).toBeGreaterThan(same);
    });
  });

  describe('distancesToConfidences', () => {
    it('returns confidences summing to ~1.0', () => {
      const result = distancesToConfidences([
        { code: 'eng', distance: 100 },
        { code: 'fra', distance: 500 },
        { code: 'deu', distance: 800 },
      ]);
      const total = result.reduce((s, r) => s + r.confidence, 0);
      expect(total).toBeCloseTo(1.0, 2);
    });

    it('gives highest confidence to lowest distance', () => {
      const result = distancesToConfidences([
        { code: 'eng', distance: 100 },
        { code: 'fra', distance: 500 },
      ]);
      expect(result[0].code).toBe('eng');
      expect(result[0].confidence).toBeGreaterThan(result[1].confidence);
    });

    it('handles empty input', () => {
      expect(distancesToConfidences([])).toEqual([]);
    });
  });

  describe('iso6393To1', () => {
    it('converts known 3-letter codes to 2-letter', () => {
      expect(iso6393To1('eng')).toBe('en');
      expect(iso6393To1('fra')).toBe('fr');
      expect(iso6393To1('deu')).toBe('de');
      expect(iso6393To1('spa')).toBe('es');
    });

    it('passes through unknown codes unchanged', () => {
      expect(iso6393To1('xyz')).toBe('xyz');
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns an array of language codes', () => {
      const langs = getSupportedLanguages();
      expect(langs.length).toBeGreaterThan(10);
      expect(langs).toContain('en');
      expect(langs).toContain('fr');
      expect(langs).toContain('de');
    });
  });

  describe('detectLanguageTrigram', () => {
    it('detects English', () => {
      const results = detectLanguageTrigram(ENGLISH_PASSAGE);
      expect(results[0].language).toBe('en');
      expect(results[0].confidence).toBeGreaterThan(0.05);
    });

    it('detects French', () => {
      const results = detectLanguageTrigram(FRENCH_PASSAGE);
      expect(results[0].language).toBe('fr');
    });

    it('detects German', () => {
      const results = detectLanguageTrigram(GERMAN_PASSAGE);
      expect(results[0].language).toBe('de');
    });

    it('detects Spanish', () => {
      const results = detectLanguageTrigram(SPANISH_PASSAGE);
      expect(results[0].language).toBe('es');
    });

    it('returns "und" for very short text', () => {
      const results = detectLanguageTrigram('hi');
      expect(results[0].language).toBe('und');
    });

    it('respects maxCandidates', () => {
      const results = detectLanguageTrigram(ENGLISH_PASSAGE, { maxCandidates: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('returns confidences between 0 and 1', () => {
      const results = detectLanguageTrigram(ENGLISH_PASSAGE);
      for (const r of results) {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// StatisticalUtilityAI.detectLanguage integration
// ---------------------------------------------------------------------------

describe('StatisticalUtilityAI.detectLanguage', () => {
  let utility: IUtilityAI;

  beforeEach(async () => {
    utility = new StatisticalUtilityAI();
    await utility.initialize(defaultConfig);
  });

  it('detects English text', async () => {
    const results = await utility.detectLanguage(ENGLISH_PASSAGE);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].language).toBe('en');
    expect(results[0].confidence).toBeGreaterThan(0);
  });

  it('detects French text', async () => {
    const results = await utility.detectLanguage(FRENCH_PASSAGE);
    expect(results[0].language).toBe('fr');
  });

  it('detects German text', async () => {
    const results = await utility.detectLanguage(GERMAN_PASSAGE);
    expect(results[0].language).toBe('de');
  });

  it('detects Spanish text', async () => {
    const results = await utility.detectLanguage(SPANISH_PASSAGE);
    expect(results[0].language).toBe('es');
  });

  it('detects Portuguese text', async () => {
    const results = await utility.detectLanguage(PORTUGUESE_PASSAGE);
    expect(results[0].language).toBe('pt');
  });

  it('detects Italian text', async () => {
    const results = await utility.detectLanguage(ITALIAN_PASSAGE);
    expect(results[0].language).toBe('it');
  });

  it('detects Dutch text', async () => {
    const results = await utility.detectLanguage(DUTCH_PASSAGE);
    expect(results[0].language).toBe('nl');
  });

  it('detects Turkish text', async () => {
    const results = await utility.detectLanguage(TURKISH_PASSAGE);
    expect(results[0].language).toBe('tr');
  });

  it('detects Polish text', async () => {
    const results = await utility.detectLanguage(POLISH_PASSAGE);
    expect(results[0].language).toBe('pl');
  });

  it('detects Swedish text', async () => {
    const results = await utility.detectLanguage(SWEDISH_PASSAGE);
    expect(results[0].language).toBe('sv');
  });

  it('falls back to default language for very short text', async () => {
    const results = await utility.detectLanguage('hi');
    expect(results).toHaveLength(1);
    expect(results[0].language).toBe('en'); // defaultLanguage from config
    expect(results[0].confidence).toBe(0.1);
  });

  it('falls back to default language for empty string', async () => {
    const results = await utility.detectLanguage('');
    expect(results).toHaveLength(1);
    expect(results[0].language).toBe('en');
    expect(results[0].confidence).toBe(0.1);
  });

  it('respects maxCandidates in options', async () => {
    const results = await utility.detectLanguage(ENGLISH_PASSAGE, { maxCandidates: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(1);
  });

  it('returns results with valid structure', async () => {
    const results = await utility.detectLanguage(FRENCH_PASSAGE);
    for (const result of results) {
      expect(result).toHaveProperty('language');
      expect(result).toHaveProperty('confidence');
      expect(typeof result.language).toBe('string');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('returns results sorted by confidence (highest first)', async () => {
    const results = await utility.detectLanguage(ENGLISH_PASSAGE, { maxCandidates: 5 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
    }
  });

  it('returns default 3 candidates', async () => {
    const results = await utility.detectLanguage(GERMAN_PASSAGE);
    expect(results).toHaveLength(3);
  });

  it('throws if not initialized', async () => {
    const uninit = new StatisticalUtilityAI();
    await expect(uninit.detectLanguage(ENGLISH_PASSAGE)).rejects.toThrow(/not initialized/i);
  });
});
