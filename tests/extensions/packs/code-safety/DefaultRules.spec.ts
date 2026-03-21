/**
 * @file DefaultRules.spec.ts
 * @description Unit tests for {@link DEFAULT_RULES} — the built-in OWASP Top 10
 * security rule set.
 *
 * Test strategy:
 * - Structural: every rule must have the required fields with valid values.
 * - Count: the array must contain at least 25 rules.
 * - Per-category: at least one rule must exist per expected category.
 * - Positive match: at least one snippet per category that SHOULD trigger a rule.
 * - Negative match: at least one snippet per category that MUST NOT trigger.
 * - Critical boundary cases: eval word-boundary, AWS key length requirements.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES } from '../../../../src/extensions/packs/code-safety/DefaultRules';
import type { ICodeSafetyRule } from '../../../../src/extensions/packs/code-safety/types';

// ---------------------------------------------------------------------------
// Helper: run all patterns of a rule against a code snippet for a given language
// ---------------------------------------------------------------------------

/**
 * Returns true if ANY pattern in the rule fires for the given code string,
 * considering both the wildcard `'*'` patterns and language-specific patterns.
 *
 * @param rule     - Rule whose patterns are tested.
 * @param code     - Code string to test.
 * @param language - Language key for language-specific patterns (e.g. 'python').
 */
function ruleMatches(rule: ICodeSafetyRule, code: string, language = '*'): boolean {
  const keysToCheck = new Set(['*', language]);
  for (const key of keysToCheck) {
    const patterns = rule.patterns[key];
    if (!patterns) continue;
    if (patterns.some((re) => re.test(code))) return true;
  }
  return false;
}

/**
 * Find the first rule with the given id, throwing if not found.
 */
function getRuleById(id: string): ICodeSafetyRule {
  const rule = DEFAULT_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`Rule not found: ${id}`);
  return rule;
}

// ---------------------------------------------------------------------------
// Structural integrity
// ---------------------------------------------------------------------------

describe('DEFAULT_RULES structural integrity', () => {
  it('exports at least 25 rules', () => {
    expect(DEFAULT_RULES.length).toBeGreaterThanOrEqual(25);
  });

  it('every rule has required string fields', () => {
    for (const rule of DEFAULT_RULES) {
      expect(typeof rule.id, `rule.id on ${rule.id}`).toBe('string');
      expect(rule.id.length, `id empty on ${rule.id}`).toBeGreaterThan(0);
      expect(typeof rule.name, `rule.name on ${rule.id}`).toBe('string');
      expect(rule.name.length, `name empty on ${rule.id}`).toBeGreaterThan(0);
      expect(typeof rule.description, `rule.description on ${rule.id}`).toBe('string');
    }
  });

  it('every rule has a valid severity', () => {
    const validSeverities = new Set(['critical', 'high', 'medium', 'low']);
    for (const rule of DEFAULT_RULES) {
      expect(validSeverities.has(rule.severity), `invalid severity on ${rule.id}: ${rule.severity}`).toBe(true);
    }
  });

  it('every rule has a valid category', () => {
    const validCategories = new Set([
      'injection', 'sql-injection', 'xss', 'path-traversal', 'secrets',
      'crypto', 'deserialization', 'ssrf', 'permissions', 'other',
    ]);
    for (const rule of DEFAULT_RULES) {
      expect(validCategories.has(rule.category), `invalid category on ${rule.id}: ${rule.category}`).toBe(true);
    }
  });

  it('every rule has at least one pattern', () => {
    for (const rule of DEFAULT_RULES) {
      const totalPatterns = Object.values(rule.patterns).flat().length;
      expect(totalPatterns, `no patterns on rule ${rule.id}`).toBeGreaterThan(0);
    }
  });

  it('rule IDs are unique', () => {
    const ids = DEFAULT_RULES.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('covers all expected categories', () => {
    const categories = new Set(DEFAULT_RULES.map((r) => r.category));
    const expected = [
      'injection', 'sql-injection', 'xss', 'path-traversal', 'secrets',
      'crypto', 'deserialization', 'ssrf', 'permissions',
    ];
    for (const cat of expected) {
      expect(categories.has(cat as ICodeSafetyRule['category']), `missing category: ${cat}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Injection rules
// ---------------------------------------------------------------------------

describe('injection rules', () => {
  describe('code-injection-eval', () => {
    const rule = getRuleById('code-injection-eval');

    it('matches eval(x) with word boundary', () => {
      expect(ruleMatches(rule, 'eval(userInput)')).toBe(true);
    });

    it('does NOT match "evaluation report"', () => {
      expect(ruleMatches(rule, 'evaluation report')).toBe(false);
    });

    it('does NOT match "evaluate()"', () => {
      // "evaluate" contains "eval" but with more chars after — word boundary should block it
      expect(ruleMatches(rule, 'evaluate(something)')).toBe(false);
    });

    it('matches Python exec()', () => {
      expect(ruleMatches(rule, 'exec(user_code)', 'python')).toBe(true);
    });

    it('matches Python compile()', () => {
      expect(ruleMatches(rule, 'compile(src, "<string>", "exec")', 'python')).toBe(true);
    });

    it('matches JS new Function()', () => {
      expect(ruleMatches(rule, 'const fn = new Function("return 1")', 'javascript')).toBe(true);
    });
  });

  describe('command-injection-system', () => {
    const rule = getRuleById('command-injection-system');

    it('matches Python os.system()', () => {
      expect(ruleMatches(rule, 'os.system(cmd)', 'python')).toBe(true);
    });

    it('matches Python subprocess.call(shell=True)', () => {
      expect(ruleMatches(rule, 'subprocess.call(cmd, shell=True)', 'python')).toBe(true);
    });

    it('does NOT match subprocess.run(cmd) without shell=True', () => {
      expect(ruleMatches(rule, 'subprocess.run(["ls", "-la"])', 'python')).toBe(false);
    });
  });

  describe('command-injection-backtick', () => {
    const rule = getRuleById('command-injection-backtick');

    it('matches Ruby backtick execution', () => {
      expect(ruleMatches(rule, '`ls -la`', 'ruby')).toBe(true);
    });

    it('does NOT match JavaScript template literals (no ruby/bash language key)', () => {
      // JS template literals look like `Hello ${name}` — should NOT match the JS language key
      // because backtick rule intentionally omits 'javascript'
      const jsKey = rule.patterns['javascript'];
      expect(jsKey).toBeUndefined();
    });

    it('does NOT match TypeScript template literals', () => {
      const tsKey = rule.patterns['typescript'];
      expect(tsKey).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// SQL injection rules
// ---------------------------------------------------------------------------

describe('sql-injection rules', () => {
  describe('sql-injection-concat', () => {
    const rule = getRuleById('sql-injection-concat');

    it('matches string concatenation into SELECT', () => {
      expect(ruleMatches(rule, '"SELECT * FROM users WHERE id = " + userId')).toBe(true);
    });

    it('does NOT match a plain parameterised query with placeholder', () => {
      // Parameterised query — no + concatenation near SQL keywords
      expect(ruleMatches(rule, 'cursor.execute("SELECT * FROM users WHERE id = ?", [userId])')).toBe(false);
    });
  });

  describe('sql-injection-keywords', () => {
    const rule = getRuleById('sql-injection-keywords');

    it("matches ' OR 1=1 tautology", () => {
      expect(ruleMatches(rule, "' OR 1=1 --")).toBe(true);
    });

    it('matches UNION SELECT payload', () => {
      expect(ruleMatches(rule, 'UNION SELECT username, password FROM users')).toBe(true);
    });

    it('matches DROP TABLE payload', () => {
      expect(ruleMatches(rule, "'; DROP TABLE users; --")).toBe(true);
    });

    it('does NOT match a normal SELECT statement', () => {
      expect(ruleMatches(rule, 'SELECT name FROM products WHERE active = 1')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// XSS rules
// ---------------------------------------------------------------------------

describe('xss rules', () => {
  describe('xss-innerhtml', () => {
    const rule = getRuleById('xss-innerhtml');

    it('matches innerHTML assignment', () => {
      expect(ruleMatches(rule, 'el.innerHTML = userHtml', 'javascript')).toBe(true);
    });

    it('does NOT match textContent assignment', () => {
      expect(ruleMatches(rule, 'el.textContent = userText', 'javascript')).toBe(false);
    });
  });

  describe('xss-document-write', () => {
    const rule = getRuleById('xss-document-write');

    it('matches document.write()', () => {
      expect(ruleMatches(rule, 'document.write("<h1>Hello</h1>")', 'javascript')).toBe(true);
    });

    it('does NOT match document.createElement()', () => {
      expect(ruleMatches(rule, 'document.createElement("div")', 'javascript')).toBe(false);
    });
  });

  describe('xss-dangerously-set', () => {
    const rule = getRuleById('xss-dangerously-set');

    it('matches dangerouslySetInnerHTML', () => {
      expect(ruleMatches(rule, '<div dangerouslySetInnerHTML={{ __html: content }} />', 'javascript')).toBe(true);
    });

    it('does NOT match a plain HTML attribute', () => {
      expect(ruleMatches(rule, '<div class="foo">bar</div>', 'javascript')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Path traversal rules
// ---------------------------------------------------------------------------

describe('path-traversal rules', () => {
  describe('path-traversal-dotdot', () => {
    const rule = getRuleById('path-traversal-dotdot');

    it('matches ../ traversal', () => {
      expect(ruleMatches(rule, '../../../etc/passwd')).toBe(true);
    });

    it('matches ..\\ Windows traversal', () => {
      expect(ruleMatches(rule, '..\\..\\windows\\system32')).toBe(true);
    });

    it('does NOT match a relative path without traversal', () => {
      expect(ruleMatches(rule, './config/settings.json')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Secrets rules
// ---------------------------------------------------------------------------

describe('secrets rules', () => {
  describe('hardcoded-aws-key', () => {
    const rule = getRuleById('hardcoded-aws-key');

    it('matches a valid AKIA key (AKIAIOSFODNN7EXAMPLE)', () => {
      // AKIAIOSFODNN7EXAMPLE is the standard AWS docs example key (20 chars total: AKIA + 16)
      expect(ruleMatches(rule, 'aws_access_key = "AKIAIOSFODNN7EXAMPLE"')).toBe(true);
    });

    it('matches another valid AKIA key format', () => {
      expect(ruleMatches(rule, 'key = AKIA0123456789ABCDEF')).toBe(true);
    });

    it('does NOT match AKIA with fewer than 16 chars after prefix', () => {
      // Only 3 chars after AKIA — too short, should not match
      expect(ruleMatches(rule, 'AKIA123')).toBe(false);
    });

    it('does NOT match a random string that starts with AKIA but has invalid chars', () => {
      // lowercase chars after AKIA — pattern requires [0-9A-Z]
      expect(ruleMatches(rule, 'AKIAabcdefghijklmnop')).toBe(false);
    });
  });

  describe('hardcoded-password', () => {
    const rule = getRuleById('hardcoded-password');

    it('matches password = "secret"', () => {
      expect(ruleMatches(rule, 'password = "supersecret"')).toBe(true);
    });

    it('matches PASSWORD: "value"', () => {
      expect(ruleMatches(rule, 'PASSWORD: "mysupersecret"')).toBe(true);
    });

    it('does NOT match password variable reference without assignment', () => {
      expect(ruleMatches(rule, 'print(password)')).toBe(false);
    });
  });

  describe('hardcoded-private-key', () => {
    const rule = getRuleById('hardcoded-private-key');

    it('matches BEGIN PRIVATE KEY PEM header', () => {
      expect(ruleMatches(rule, '-----BEGIN PRIVATE KEY-----')).toBe(true);
    });

    it('matches BEGIN RSA PRIVATE KEY PEM header', () => {
      expect(ruleMatches(rule, '-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    });

    it('matches BEGIN OPENSSH PRIVATE KEY', () => {
      expect(ruleMatches(rule, '-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    });

    it('does NOT match BEGIN CERTIFICATE (public cert, not private key)', () => {
      expect(ruleMatches(rule, '-----BEGIN CERTIFICATE-----')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Crypto rules
// ---------------------------------------------------------------------------

describe('crypto rules', () => {
  describe('weak-crypto-hash', () => {
    const rule = getRuleById('weak-crypto-hash');

    it('matches Python hashlib.md5()', () => {
      expect(ruleMatches(rule, 'h = hashlib.md5(data)', 'python')).toBe(true);
    });

    it('matches Python hashlib.sha1()', () => {
      expect(ruleMatches(rule, 'digest = hashlib.sha1(content)', 'python')).toBe(true);
    });

    it('matches JS crypto.createHash("md5")', () => {
      expect(ruleMatches(rule, 'crypto.createHash("md5").update(data)', 'javascript')).toBe(true);
    });

    it('does NOT match hashlib.sha256()', () => {
      expect(ruleMatches(rule, 'hashlib.sha256(data)', 'python')).toBe(false);
    });
  });

  describe('insecure-random', () => {
    const rule = getRuleById('insecure-random');

    it('matches Math.random()', () => {
      expect(ruleMatches(rule, 'const token = Math.random()', 'javascript')).toBe(true);
    });

    it('matches Python random.random()', () => {
      expect(ruleMatches(rule, 'val = random.random()', 'python')).toBe(true);
    });

    it('does NOT match crypto.getRandomValues()', () => {
      expect(ruleMatches(rule, 'crypto.getRandomValues(new Uint8Array(16))', 'javascript')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Deserialization rules
// ---------------------------------------------------------------------------

describe('deserialization rules', () => {
  describe('insecure-pickle', () => {
    const rule = getRuleById('insecure-pickle');

    it('matches pickle.loads()', () => {
      expect(ruleMatches(rule, 'obj = pickle.loads(data)', 'python')).toBe(true);
    });

    it('matches pickle.load()', () => {
      expect(ruleMatches(rule, 'data = pickle.load(f)', 'python')).toBe(true);
    });

    it('does NOT match pickle.dumps() (serialisation, not deserialisation)', () => {
      expect(ruleMatches(rule, 'blob = pickle.dumps(obj)', 'python')).toBe(false);
    });
  });

  describe('insecure-yaml', () => {
    const rule = getRuleById('insecure-yaml');

    it('matches yaml.load() without Loader argument', () => {
      expect(ruleMatches(rule, 'data = yaml.load(stream)', 'python')).toBe(true);
    });

    it('does NOT match yaml.load() with Loader=yaml.SafeLoader', () => {
      expect(ruleMatches(rule, 'data = yaml.load(stream, Loader=yaml.SafeLoader)', 'python')).toBe(false);
    });

    it('does NOT match yaml.safe_load()', () => {
      expect(ruleMatches(rule, 'data = yaml.safe_load(stream)', 'python')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// SSRF rules
// ---------------------------------------------------------------------------

describe('ssrf rules', () => {
  describe('ssrf-unvalidated-url', () => {
    const rule = getRuleById('ssrf-unvalidated-url');

    it('matches requests.get(url) with user-controlled variable', () => {
      expect(ruleMatches(rule, 'requests.get(url)', 'python')).toBe(true);
    });

    it('matches fetch(url) in JavaScript', () => {
      expect(ruleMatches(rule, 'fetch(url)', 'javascript')).toBe(true);
    });

    it('does NOT match requests.get() with hardcoded literal', () => {
      // A hardcoded string "https://api.example.com" won't match the user-input patterns
      expect(ruleMatches(rule, 'requests.get("https://api.example.com/data")', 'python')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Permissions rules
// ---------------------------------------------------------------------------

describe('permissions rules', () => {
  describe('world-writable', () => {
    const rule = getRuleById('world-writable');

    it('matches octal 0777', () => {
      expect(ruleMatches(rule, 'os.chmod(path, 0777)')).toBe(true);
    });

    it('matches octal 0o777', () => {
      expect(ruleMatches(rule, 'os.chmod(path, 0o777)')).toBe(true);
    });

    it('matches octal 0666', () => {
      expect(ruleMatches(rule, 'os.chmod(path, 0o666)')).toBe(true);
    });

    it('does NOT match 0o644 (owner R/W, others read-only)', () => {
      expect(ruleMatches(rule, 'os.chmod(path, 0o644)')).toBe(false);
    });

    it('does NOT match 0o755 (standard executable permissions)', () => {
      expect(ruleMatches(rule, 'os.chmod(path, 0o755)')).toBe(false);
    });
  });

  describe('insecure-tmp', () => {
    const rule = getRuleById('insecure-tmp');

    it('matches "/tmp/" string reference', () => {
      expect(ruleMatches(rule, 'path = "/tmp/output.txt"')).toBe(true);
    });

    it('does NOT match a path that merely contains "tmp" elsewhere', () => {
      expect(ruleMatches(rule, 'tmpDir = mkdtemp()')).toBe(false);
    });
  });
});
