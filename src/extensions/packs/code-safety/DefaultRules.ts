/**
 * @file DefaultRules.ts
 * @description Built-in security rules covering OWASP Top 10 vulnerability
 * categories for the code safety scanner extension pack.
 *
 * ## Rule count and coverage
 *
 * This module exports {@link DEFAULT_RULES} — an array of ~25
 * {@link ICodeSafetyRule} objects organised into 9 OWASP-aligned categories:
 *
 * | Category         | Rules | Severity range     |
 * |------------------|-------|--------------------|
 * | injection        | 5     | critical–medium    |
 * | sql-injection    | 3     | critical–high      |
 * | xss              | 3     | high–medium        |
 * | path-traversal   | 2     | high–medium        |
 * | secrets          | 4     | critical–high      |
 * | crypto           | 2     | medium             |
 * | deserialization  | 2     | critical–high      |
 * | ssrf             | 2     | high–medium        |
 * | permissions      | 2     | high–low           |
 *
 * ## Pattern design notes
 *
 * - Language-keyed patterns in `ICodeSafetyRule.patterns` are matched against
 *   the normalised language of a code block.  The wildcard key `'*'` matches
 *   ALL languages.
 * - Word boundaries (`\b`) are used wherever a pattern keyword could appear as
 *   a substring of a longer identifier (e.g. `eval` must not match `evaluation`).
 * - Negative lookaheads are used where a safe variant of a pattern exists
 *   (e.g. `yaml.load` is dangerous unless `Loader=` is specified).
 * - Language-specific scoping (e.g. backtick injection only in ruby/perl/bash)
 *   prevents false positives from JavaScript template literals.
 *
 * @module code-safety/DefaultRules
 */

import type { ICodeSafetyRule } from './types';

// ===========================================================================
// INJECTION RULES (5)
// ===========================================================================

/**
 * Detects direct use of `eval()` (all languages) and Python's `exec()`/`compile()`
 * which execute arbitrary dynamic code, enabling full remote code execution when
 * the argument is attacker-controlled.
 *
 * Note: `\beval\s*\(` uses a word boundary so `evaluation(` is NOT matched.
 */
const RULE_CODE_INJECTION_EVAL: ICodeSafetyRule = {
  id: 'code-injection-eval',
  name: 'Unsafe eval() / exec() usage',
  description:
    'Calling eval(), exec(), or compile() on dynamic or user-supplied strings ' +
    'allows an attacker to execute arbitrary code in the runtime environment.  ' +
    'Replace with a safe parser, sandboxed interpreter, or structured data format.',
  category: 'injection',
  severity: 'critical',
  patterns: {
    // Match eval(...) in any language — word boundary prevents matching "evaluation"
    '*': [/\beval\s*\(/],
    // Python-specific: exec() and compile() execute arbitrary code
    python: [/\bexec\s*\(/, /\bcompile\s*\(/],
    // JavaScript: new Function() constructs executable code from a string;
    // setTimeout/setInterval with a string first argument evaluates that string
    javascript: [/\bnew\s+Function\s*\(/, /\bsetTimeout\s*\(\s*["'`]/, /\bsetInterval\s*\(\s*["'`]/],
    // PHP: passthru / shell_exec send input directly to the OS shell
    php: [/\bpassthru\s*\(/, /\bshell_exec\s*\(/],
  },
};

/**
 * Detects operating-system command execution via the host's shell.
 *
 * `os.system()` and `subprocess.call(shell=True)` in Python, and `system()`/`exec()`
 * in PHP pass their argument to `/bin/sh -c`, allowing shell meta-characters to
 * inject additional commands.
 */
const RULE_COMMAND_INJECTION_SYSTEM: ICodeSafetyRule = {
  id: 'command-injection-system',
  name: 'OS command execution via shell',
  description:
    'Passing user-controlled input to os.system(), subprocess.call(shell=True), ' +
    'or PHP system()/exec() runs commands in the OS shell and is vulnerable to ' +
    'shell injection (e.g. appending && rm -rf /).  Use subprocess.run() with a ' +
    'list argument (no shell=True) or a parameterised API instead.',
  category: 'injection',
  severity: 'critical',
  patterns: {
    // Python: os.system() and subprocess variants with shell=True
    python: [
      /\bos\.system\s*\(/,
      /\bsubprocess\.call\s*\([^)]*shell\s*=\s*True/,
      /\bsubprocess\.run\s*\([^)]*shell\s*=\s*True/,
      /\bsubprocess\.Popen\s*\([^)]*shell\s*=\s*True/,
    ],
    // Ruby: Kernel.system() and backtick operator are handled separately
    ruby: [/\bsystem\s*\(/],
    // PHP: system() and exec() pass input to the shell
    php: [/\bsystem\s*\(/, /\bexec\s*\(/],
  },
};

/**
 * Detects backtick-based command execution in Ruby, Perl, and Bash.
 *
 * IMPORTANT: This rule intentionally does NOT include JavaScript/TypeScript in
 * its language keys.  JavaScript template literals use the same backtick
 * character and would produce pervasive false positives.
 *
 * In Ruby/Perl/Bash the backtick operator `` `cmd` `` executes a shell command
 * and returns its output — identical in danger to `system()`.
 */
const RULE_COMMAND_INJECTION_BACKTICK: ICodeSafetyRule = {
  id: 'command-injection-backtick',
  name: 'Backtick command execution (Ruby / Perl / Bash)',
  description:
    'Backtick expressions in Ruby, Perl, and Bash execute OS commands via the ' +
    'shell.  If the command string is built from user input an attacker can inject ' +
    'arbitrary shell commands.  Use a library method with a list of arguments instead.',
  category: 'injection',
  severity: 'high',
  patterns: {
    // Ruby: `cmd` operator — backtick NOT inside a string interpolation context
    ruby: [/`[^`]+`/],
    // Perl: same backtick operator
    perl: [/`[^`]+`/],
    // Bash: backtick is legacy command substitution ($(cmd) is preferred)
    bash: [/`[^`]+`/],
  },
};

/**
 * Detects potentially dangerous template injection patterns where user input
 * is interpolated directly into template strings that are later rendered or
 * evaluated (e.g. SSTI, Jinja2 injection).
 */
const RULE_CODE_INJECTION_TEMPLATE: ICodeSafetyRule = {
  id: 'code-injection-template',
  name: 'Potential template injection',
  description:
    'Interpolating user input directly into Jinja2 / Twig / Smarty templates or ' +
    'JavaScript template literals that are later eval-ed enables Server-Side ' +
    'Template Injection (SSTI).  Use a sandboxed template renderer or escape ' +
    'user data before inclusion.',
  category: 'injection',
  severity: 'medium',
  patterns: {
    // Python: Jinja2 / Mako render(request.args...) patterns
    python: [/\brender_template_string\s*\(/, /\bTemplate\s*\(\s*(?:request|input|user)/],
    // JavaScript: tagged template literal eval patterns
    javascript: [/\beval\s*\(`/, /\bnew\s+Function\s*\(`/],
  },
};

/**
 * Detects unsafe dynamic class / function loading patterns (reflection abuse).
 *
 * Reflection APIs such as `importlib.import_module()` and
 * `__import__()` in Python or `Class.forName()` in Java allow an attacker to
 * load arbitrary classes when the module/class name is user-controlled.
 */
const RULE_UNSAFE_REFLECTION: ICodeSafetyRule = {
  id: 'unsafe-reflection',
  name: 'Unsafe dynamic class loading (reflection)',
  description:
    'Dynamically loading a class or module whose name is derived from user input ' +
    'can allow an attacker to instantiate unintended classes or import malicious ' +
    'modules.  Validate the module/class name against a strict allowlist before loading.',
  category: 'injection',
  severity: 'medium',
  patterns: {
    // Python: importlib and __import__ with dynamic arguments
    python: [/\bimportlib\.import_module\s*\(/, /\b__import__\s*\(/],
    // Java: reflection API
    java: [/\bClass\.forName\s*\(/, /\bMethod\.invoke\s*\(/],
    // PHP: variable functions / variable class instantiation
    php: [/\$\w+\s*\(\s*\$/, /\bnew\s+\$\w+\s*\(/],
  },
};

// ===========================================================================
// SQL INJECTION RULES (3)
// ===========================================================================

/**
 * Detects string concatenation inside SQL query construction — the classic
 * SQL injection vector where unsanitised user input is glued into a query.
 */
const RULE_SQL_INJECTION_CONCAT: ICodeSafetyRule = {
  id: 'sql-injection-concat',
  name: 'SQL query string concatenation',
  description:
    'Building SQL queries by concatenating or formatting user-supplied strings ' +
    'directly into the query is the primary cause of SQL injection.  ' +
    'Use parameterised queries / prepared statements with placeholders (?, %s, :param) ' +
    'so the database driver handles escaping.',
  category: 'sql-injection',
  severity: 'critical',
  patterns: {
    // Universal: "SELECT ... " + variable concatenation
    '*': [
      /["'`]\s*\+\s*\w+.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i,
      /(?:SELECT|INSERT|UPDATE|DELETE|WHERE)[^"']*["'`]\s*\+/i,
    ],
    // Python: f-string / .format() / % interpolation into SQL keywords
    python: [
      /f["'].*(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*\{/i,
      /["'].*(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*%\s*(?:\w|\()/i,
      /["'].*(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*\.format\s*\(/i,
    ],
    // JavaScript: template literal or string concat into SQL
    javascript: [
      /`.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*\$\{/i,
    ],
  },
};

/**
 * Detects `%` / `format()` / f-string substitution into SQL strings, a
 * stylistic variant of SQL injection common in Python/PHP codebases.
 */
const RULE_SQL_INJECTION_FORMAT: ICodeSafetyRule = {
  id: 'sql-injection-format',
  name: 'SQL injection via string formatting',
  description:
    'Using Python % formatting, .format(), or PHP sprintf() to substitute ' +
    'variables into SQL strings is vulnerable to injection when the variable ' +
    'is not properly escaped.  Switch to parameterised queries.',
  category: 'sql-injection',
  severity: 'high',
  patterns: {
    // Python cursor.execute with % formatting
    python: [
      /cursor\.execute\s*\(\s*["'][^'"]*%[sd]/,
      /cursor\.execute\s*\(\s*f["']/,
    ],
    // PHP: unsanitised string passed to mysqli_query / PDO::query
    php: [
      /mysqli_query\s*\(\s*\$\w+\s*,\s*["'][^'"]*\.\s*\$/,
      /\$pdo->query\s*\(\s*["'][^'"]*\.\s*\$/,
    ],
  },
};

/**
 * Detects classic SQL injection tautology patterns that attackers use to
 * bypass authentication or extract data from databases.
 */
const RULE_SQL_INJECTION_KEYWORDS: ICodeSafetyRule = {
  id: 'sql-injection-keywords',
  name: "SQL injection tautology / UNION payload patterns",
  description:
    "Patterns like \" ' OR 1=1 \", \"UNION SELECT\", and \"DROP TABLE\" appear in " +
    'typical SQL injection payloads.  Their presence in code suggests either ' +
    'a deliberate injection payload being constructed or an unvalidated query string.',
  category: 'sql-injection',
  severity: 'high',
  patterns: {
    // Any language: match the payload strings themselves
    '*': [
      /'\s*OR\s+1\s*=\s*1/i,      // ' OR 1=1 — tautology bypass
      /\bUNION\s+(?:ALL\s+)?SELECT\b/i,  // UNION SELECT data extraction
      /\bDROP\s+TABLE\b/i,        // DROP TABLE — destructive payload
      /--\s*$|;\s*--/m,           // SQL comment terminator (end-of-injection)
    ],
  },
};

// ===========================================================================
// XSS RULES (3)
// ===========================================================================

/**
 * Detects assignment to `element.innerHTML` with a potentially dynamic value,
 * which bypasses browser HTML escaping and allows script injection.
 */
const RULE_XSS_INNERHTML: ICodeSafetyRule = {
  id: 'xss-innerhtml',
  name: 'XSS via innerHTML assignment',
  description:
    'Setting `element.innerHTML` with user-controlled data allows Cross-Site ' +
    'Scripting (XSS) because the browser parses and executes any `<script>` tags ' +
    'or event handlers in the string.  Use `textContent` for plain text, or a ' +
    'sanitisation library (DOMPurify) before assigning to innerHTML.',
  category: 'xss',
  severity: 'high',
  patterns: {
    // JavaScript / TypeScript: innerHTML direct assignment
    javascript: [/\.innerHTML\s*=/],
    typescript: [/\.innerHTML\s*=/],
  },
};

/**
 * Detects `document.write()` calls which render raw HTML into the document,
 * enabling XSS when the argument contains user-controlled content.
 */
const RULE_XSS_DOCUMENT_WRITE: ICodeSafetyRule = {
  id: 'xss-document-write',
  name: 'XSS via document.write()',
  description:
    '`document.write()` injects raw HTML directly into the document.  When the ' +
    'argument includes user-controlled data it allows XSS.  Use DOM APIs ' +
    '(`createElement`, `textContent`, `appendChild`) instead.',
  category: 'xss',
  severity: 'high',
  patterns: {
    javascript: [/\bdocument\.write\s*\(/],
    typescript: [/\bdocument\.write\s*\(/],
  },
};

/**
 * Detects React's `dangerouslySetInnerHTML` prop usage, which explicitly
 * opts out of React's XSS protections.
 */
const RULE_XSS_DANGEROUSLY_SET: ICodeSafetyRule = {
  id: 'xss-dangerously-set',
  name: 'React dangerouslySetInnerHTML usage',
  description:
    '`dangerouslySetInnerHTML` bypasses React\'s automatic HTML escaping.  ' +
    'Only use it with trusted, pre-sanitised HTML.  Never pass user-supplied ' +
    'strings without running them through DOMPurify or an equivalent library first.',
  category: 'xss',
  severity: 'medium',
  patterns: {
    javascript: [/dangerouslySetInnerHTML/],
    typescript: [/dangerouslySetInnerHTML/],
  },
};

// ===========================================================================
// PATH TRAVERSAL RULES (2)
// ===========================================================================

/**
 * Detects literal `../` sequences inside file paths, the canonical
 * path-traversal attack vector used to escape a sandboxed directory.
 */
const RULE_PATH_TRAVERSAL_DOTDOT: ICodeSafetyRule = {
  id: 'path-traversal-dotdot',
  name: 'Path traversal via ../ sequences',
  description:
    'File path strings containing `../` allow an attacker to escape the intended ' +
    'directory and access arbitrary files on the filesystem.  Validate and ' +
    'canonicalise paths with `path.resolve()` / `os.path.realpath()` and reject ' +
    'any result that lies outside the expected base directory.',
  category: 'path-traversal',
  severity: 'high',
  patterns: {
    // Matches ../ or ..\\ traversal sequences in any language
    '*': [/\.\.[/\\]/],
  },
};

/**
 * Detects file-open / read operations where the path argument appears to be
 * user-supplied (passed as a variable rather than a string literal), which
 * suggests the path may not have been sanitised.
 */
const RULE_PATH_TRAVERSAL_USER_INPUT: ICodeSafetyRule = {
  id: 'path-traversal-user-input',
  name: 'File open with potentially user-controlled path',
  description:
    'Opening files with a path derived from user input without validation enables ' +
    'path traversal.  Always resolve the path to an absolute canonical form and ' +
    'verify it starts with the expected base directory before opening the file.',
  category: 'path-traversal',
  severity: 'medium',
  patterns: {
    // Python: open(user_input) or open(request...) — variable path argument
    python: [
      /\bopen\s*\(\s*(?:request\.|input\s*\(|f["']|[\w_]*(?:path|file|name|dir)\w*)/i,
    ],
    // Node.js: fs.readFile / fs.readFileSync with variable path
    javascript: [
      /\bfs\.(?:readFile|readFileSync|writeFile|writeFileSync|open)\s*\(\s*(?:req\.|request\.|user|input|\$)/i,
    ],
    typescript: [
      /\bfs\.(?:readFile|readFileSync|writeFile|writeFileSync|open)\s*\(\s*(?:req\.|request\.|user|input|\$)/i,
    ],
  },
};

// ===========================================================================
// SECRETS RULES (4)
// ===========================================================================

/**
 * Detects hardcoded AWS Access Key IDs matching the `AKIA[0-9A-Z]{16}` format
 * defined by Amazon.  Exposed keys provide full AWS API access to attackers who
 * find them in source code or logs.
 */
const RULE_HARDCODED_AWS_KEY: ICodeSafetyRule = {
  id: 'hardcoded-aws-key',
  name: 'Hardcoded AWS Access Key ID',
  description:
    'AWS Access Key IDs (AKIA[0-9A-Z]{16}) embedded directly in source code ' +
    'will be exposed to anyone with access to the repository or binary.  ' +
    'Use AWS IAM roles, environment variables, or AWS Secrets Manager instead.',
  category: 'secrets',
  severity: 'critical',
  patterns: {
    // AKIA prefix followed by exactly 16 uppercase alphanumeric characters
    '*': [/AKIA[0-9A-Z]{16}/],
  },
};

/**
 * Detects hardcoded password assignments in common patterns such as
 * `password = "secret"` or `PASSWORD: "mysecret"`.
 */
const RULE_HARDCODED_PASSWORD: ICodeSafetyRule = {
  id: 'hardcoded-password',
  name: 'Hardcoded password in source code',
  description:
    'Hardcoded passwords in source code are a critical security risk: they are ' +
    'committed to version control, visible in build artefacts, and cannot be ' +
    'rotated without a code change.  Store passwords in environment variables, ' +
    'a secrets manager, or a vault.',
  category: 'secrets',
  severity: 'high',
  patterns: {
    // Matches password/passwd/pwd assignments to non-empty string literals
    '*': [
      /\b(?:password|passwd|pwd)\s*[=:]\s*["'][^"']{4,}["']/i,
      /\bPASSWORD\s*[=:]\s*["'][^"']{4,}["']/,
    ],
  },
};

/**
 * Detects hardcoded API tokens or secret keys embedded in source code,
 * including common provider-specific prefixes (GitHub, Slack, Stripe, etc.).
 */
const RULE_HARDCODED_TOKEN: ICodeSafetyRule = {
  id: 'hardcoded-token',
  name: 'Hardcoded API token or secret key',
  description:
    'Secret tokens, API keys, and bearer credentials hardcoded in source code ' +
    'are exposed to any party who can read the code, including CI logs and ' +
    'compiled artefacts.  Store credentials in environment variables or a ' +
    'dedicated secrets manager.',
  category: 'secrets',
  severity: 'high',
  patterns: {
    // Generic token/secret/api_key assignment
    '*': [
      /\b(?:api_key|apikey|secret|token|auth_token|access_token)\s*[=:]\s*["'][^"']{8,}["']/i,
      // GitHub Personal Access Token prefix
      /\bghp_[0-9a-zA-Z]{36}/,
      // Slack bot token
      /\bxoxb-[0-9]{11}-[0-9]{11}-[0-9a-zA-Z]{24}/,
      // Stripe secret key
      /\bsk_(?:live|test)_[0-9a-zA-Z]{24,}/,
    ],
  },
};

/**
 * Detects PEM-encoded private key blocks embedded in source code.
 * Exposed private keys compromise TLS certificates, SSH authentication,
 * and code signing infrastructure.
 */
const RULE_HARDCODED_PRIVATE_KEY: ICodeSafetyRule = {
  id: 'hardcoded-private-key',
  name: 'Hardcoded PEM private key',
  description:
    'PEM-encoded private keys (-----BEGIN PRIVATE KEY-----) embedded in source ' +
    'code expose cryptographic material to anyone who reads the file.  ' +
    'Store private keys in a secure keystore, HSM, or secrets manager and ' +
    'never commit them to version control.',
  category: 'secrets',
  severity: 'critical',
  patterns: {
    // BEGIN PRIVATE KEY covers RSA, EC, and PKCS#8 private keys
    '*': [
      /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----/,
      /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/,
    ],
  },
};

// ===========================================================================
// CRYPTO RULES (2)
// ===========================================================================

/**
 * Detects use of MD5 and SHA-1 hashing algorithms, which are cryptographically
 * broken and should not be used for password hashing, integrity verification,
 * or digital signatures.
 */
const RULE_WEAK_CRYPTO_HASH: ICodeSafetyRule = {
  id: 'weak-crypto-hash',
  name: 'Weak cryptographic hash (MD5 / SHA-1)',
  description:
    'MD5 and SHA-1 are cryptographically broken: collision attacks are feasible ' +
    'and pre-image resistance is weakened.  For passwords use bcrypt, scrypt, or ' +
    'Argon2; for integrity checks use SHA-256 or SHA-3.',
  category: 'crypto',
  severity: 'medium',
  patterns: {
    // Python hashlib
    python: [/\bhashlib\.(?:md5|sha1)\s*\(/i],
    // JavaScript crypto module
    javascript: [/\bcrypto\.createHash\s*\(\s*["'](?:md5|sha1)["']/i],
    typescript: [/\bcrypto\.createHash\s*\(\s*["'](?:md5|sha1)["']/i],
    // Java: MessageDigest.getInstance("MD5")
    java: [/\bMessageDigest\.getInstance\s*\(\s*["'](?:MD5|SHA-?1)["']/i],
    // PHP: md5() / sha1() builtins
    php: [/\bmd5\s*\(/, /\bsha1\s*\(/],
    // Generic: md5( or sha1( call pattern
    '*': [/\bmd5\s*\(/, /\bsha1\s*\(/],
  },
};

/**
 * Detects use of insecure pseudo-random number generators (Math.random(),
 * random.random()) in security-sensitive contexts such as token generation,
 * session IDs, or cryptographic operations.
 */
const RULE_INSECURE_RANDOM: ICodeSafetyRule = {
  id: 'insecure-random',
  name: 'Insecure pseudo-random number generator',
  description:
    'Math.random() (JavaScript) and random.random() (Python) are NOT ' +
    'cryptographically secure PRNGs — their output is predictable and must ' +
    'not be used for token generation, session IDs, passwords, or any security- ' +
    'sensitive value.  Use crypto.getRandomValues() or secrets.token_bytes() instead.',
  category: 'crypto',
  severity: 'medium',
  patterns: {
    javascript: [/\bMath\.random\s*\(\s*\)/],
    typescript: [/\bMath\.random\s*\(\s*\)/],
    python: [/\brandom\.random\s*\(\s*\)/, /\brandom\.randint\s*\(/],
    php: [/\brand\s*\(/, /\bmt_rand\s*\(/],
  },
};

// ===========================================================================
// DESERIALIZATION RULES (2)
// ===========================================================================

/**
 * Detects use of Python's `pickle.load()` / `pickle.loads()` which execute
 * arbitrary Python code embedded in the serialised data.  Loading attacker-
 * controlled pickle data is equivalent to remote code execution.
 */
const RULE_INSECURE_PICKLE: ICodeSafetyRule = {
  id: 'insecure-pickle',
  name: 'Insecure pickle deserialization',
  description:
    'Python\'s pickle module can execute arbitrary code during deserialization. ' +
    'Never deserialise pickle data from untrusted sources.  Use a safe format ' +
    'such as JSON, MessagePack, or Protocol Buffers with strict schema validation.',
  category: 'deserialization',
  severity: 'critical',
  patterns: {
    python: [
      /\bpickle\.loads?\s*\(/,
      /\bcPickle\.loads?\s*\(/,
    ],
  },
};

/**
 * Detects unsafe `yaml.load()` calls without a `Loader=` argument.
 *
 * PyYAML's `yaml.load()` without specifying `Loader=yaml.SafeLoader` (or
 * equivalent) deserialises Python objects from YAML, enabling arbitrary code
 * execution via crafted YAML payloads.  The safe variant is
 * `yaml.safe_load()` or `yaml.load(data, Loader=yaml.SafeLoader)`.
 *
 * A negative lookahead ensures `yaml.load(data, Loader=...)` is NOT flagged.
 */
const RULE_INSECURE_YAML: ICodeSafetyRule = {
  id: 'insecure-yaml',
  name: 'Unsafe yaml.load() without explicit Loader',
  description:
    'PyYAML\'s yaml.load() without Loader=yaml.SafeLoader (or CSafeLoader) ' +
    'can deserialise arbitrary Python objects, enabling remote code execution. ' +
    'Replace with yaml.safe_load() or pass Loader=yaml.SafeLoader explicitly.',
  category: 'deserialization',
  severity: 'high',
  patterns: {
    // Negative lookahead: do NOT match when Loader= is present in the call
    python: [/\byaml\.load\s*\((?![^)]*Loader\s*=)/],
  },
};

// ===========================================================================
// SSRF RULES (2)
// ===========================================================================

/**
 * Detects HTTP request calls where the URL appears to be derived from user
 * input (request parameters, user variables), enabling Server-Side Request
 * Forgery (SSRF) attacks.
 */
const RULE_SSRF_UNVALIDATED_URL: ICodeSafetyRule = {
  id: 'ssrf-unvalidated-url',
  name: 'SSRF — HTTP request with potentially user-controlled URL',
  description:
    'Making HTTP requests to a URL constructed from user-supplied input without ' +
    'validation enables SSRF: an attacker can reach internal services, cloud ' +
    'metadata endpoints (169.254.169.254), or arbitrary hosts.  Validate the ' +
    'URL against an allowlist of permitted hosts and schemes before making the request.',
  category: 'ssrf',
  severity: 'high',
  patterns: {
    // Python: requests.get/post with user-controlled URL variable
    python: [
      /\brequests\.(?:get|post|put|delete|head|request)\s*\(\s*(?:url|request\.|user|input|f["'].*\{)/i,
      /\burllib\.request\.urlopen\s*\(\s*(?:url|request\.|user|input)/i,
    ],
    // JavaScript: fetch / axios / http.get with variable URL
    javascript: [
      /\bfetch\s*\(\s*(?:url|req\.|request\.|user|input|\$\{)/i,
      /\baxios\.(?:get|post|put|delete)\s*\(\s*(?:url|req\.|request\.|user|input)/i,
    ],
    typescript: [
      /\bfetch\s*\(\s*(?:url|req\.|request\.|user|input|\$\{)/i,
      /\baxios\.(?:get|post|put|delete)\s*\(\s*(?:url|req\.|request\.|user|input)/i,
    ],
  },
};

/**
 * Detects HTTP client configuration that follows redirects without restriction,
 * which can be exploited in SSRF chains to bypass host-based allowlists.
 */
const RULE_SSRF_REDIRECT_FOLLOW: ICodeSafetyRule = {
  id: 'ssrf-redirect-follow',
  name: 'SSRF — unrestricted redirect following',
  description:
    'Allowing HTTP clients to follow an unlimited number of redirects can ' +
    'enable redirect-based SSRF where the initial request is to a permitted host ' +
    'but subsequent redirects lead to internal services.  Set a maximum redirect ' +
    'limit and validate each redirect target.',
  category: 'ssrf',
  severity: 'medium',
  patterns: {
    // Python requests: allow_redirects=True with no max_redirects limit
    python: [/\ballow_redirects\s*=\s*True/],
    // JavaScript: follow: 'follow' in node-fetch options
    javascript: [/\bfollow\s*:\s*['"]follow['"]/],
    typescript: [/\bfollow\s*:\s*['"]follow['"]/],
    // curl in Bash with -L (follow redirects) and no --max-redirs limit
    bash: [/\bcurl\b[^;]*\s-L\b(?![^;]*--max-redirs)/],
  },
};

// ===========================================================================
// PERMISSIONS RULES (2)
// ===========================================================================

/**
 * Detects file permission modes that grant write access to all system users
 * (world-writable: mode bits include 0o002 or 0o022 patterns).  World-writable
 * files can be modified by any process on the system.
 */
const RULE_WORLD_WRITABLE: ICodeSafetyRule = {
  id: 'world-writable',
  name: 'World-writable file permissions',
  description:
    'Setting file permissions to 0777, 0o777, 0666, or similar world-writable ' +
    'modes allows any user on the system to overwrite the file, enabling ' +
    'privilege escalation and data tampering.  Use the most restrictive ' +
    'permissions that still allow the application to function (e.g. 0o644, 0o755).',
  category: 'permissions',
  severity: 'high',
  patterns: {
    // Octal literals: 0777, 0o777, 0666, 0o666
    '*': [
      /\b0o?777\b/,               // 0777 or 0o777 — full world R/W/X
      /\b0o?666\b/,               // 0666 — world R/W (no execute)
    ],
    // chmod 777 in bash
    bash: [/\bchmod\s+(?:0?777|a\+(?:rwx|wx))\b/],
    // Python os.chmod(path, 0o777)
    python: [/\bos\.chmod\s*\([^)]*0o?777/],
  },
};

/**
 * Detects use of `/tmp` or `os.tmpdir()` for storing sensitive data, which
 * is world-readable on most POSIX systems and is a common attack vector for
 * symlink attacks and information disclosure.
 */
const RULE_INSECURE_TMP: ICodeSafetyRule = {
  id: 'insecure-tmp',
  name: 'Insecure temporary file / directory usage',
  description:
    'Storing sensitive data in /tmp or os.tmpdir() without creating a secure ' +
    'temporary file (e.g. via mkstemp / tempfile.mkdtemp) exposes data to other ' +
    'users on the system and enables symlink-based attacks.  Use secure temporary ' +
    'file APIs that set restrictive permissions and create files atomically.',
  category: 'permissions',
  severity: 'low',
  patterns: {
    // Direct /tmp path references
    '*': [/["'`]\/tmp\//],
    // Python: hardcoded /tmp or os.tmpdir without mkstemp
    python: [/\bopen\s*\(\s*["']\/tmp\//, /\bos\.path\.join\s*\(\s*["']\/tmp['"]/],
    // Node.js: path.join(os.tmpdir(), ...) is acceptable but /tmp/ string is not
    javascript: [/\bpath\.join\s*\(\s*["']\/tmp\//],
    typescript: [/\bpath\.join\s*\(\s*["']\/tmp\//],
    // Bash: redirect to /tmp without mktemp
    bash: [/>\s*\/tmp\/\w+(?!\s*\$\(mktemp)/],
  },
};

// ===========================================================================
// Exported aggregate
// ===========================================================================

/**
 * The complete set of built-in security rules shipped with the code safety
 * scanner extension pack.
 *
 * Rules are ordered by category and severity for readability; the scanner does
 * NOT rely on ordering — all rules are tested against every code block.
 *
 * Consumers may extend this array with custom rules via
 * {@link CodeSafetyPackOptions.customRules} or reduce it by specifying
 * {@link CodeSafetyPackOptions.disabledRules}.
 *
 * @see {@link ICodeSafetyRule} for the shape of each rule object.
 */
export const DEFAULT_RULES: ICodeSafetyRule[] = [
  // ── Injection (5) ──────────────────────────────────────────────────────
  RULE_CODE_INJECTION_EVAL,
  RULE_COMMAND_INJECTION_SYSTEM,
  RULE_COMMAND_INJECTION_BACKTICK,
  RULE_CODE_INJECTION_TEMPLATE,
  RULE_UNSAFE_REFLECTION,

  // ── SQL Injection (3) ──────────────────────────────────────────────────
  RULE_SQL_INJECTION_CONCAT,
  RULE_SQL_INJECTION_FORMAT,
  RULE_SQL_INJECTION_KEYWORDS,

  // ── XSS (3) ────────────────────────────────────────────────────────────
  RULE_XSS_INNERHTML,
  RULE_XSS_DOCUMENT_WRITE,
  RULE_XSS_DANGEROUSLY_SET,

  // ── Path Traversal (2) ─────────────────────────────────────────────────
  RULE_PATH_TRAVERSAL_DOTDOT,
  RULE_PATH_TRAVERSAL_USER_INPUT,

  // ── Secrets (4) ────────────────────────────────────────────────────────
  RULE_HARDCODED_AWS_KEY,
  RULE_HARDCODED_PASSWORD,
  RULE_HARDCODED_TOKEN,
  RULE_HARDCODED_PRIVATE_KEY,

  // ── Crypto (2) ─────────────────────────────────────────────────────────
  RULE_WEAK_CRYPTO_HASH,
  RULE_INSECURE_RANDOM,

  // ── Deserialization (2) ────────────────────────────────────────────────
  RULE_INSECURE_PICKLE,
  RULE_INSECURE_YAML,

  // ── SSRF (2) ───────────────────────────────────────────────────────────
  RULE_SSRF_UNVALIDATED_URL,
  RULE_SSRF_REDIRECT_FOLLOW,

  // ── Permissions (2) ───────────────────────────────────────────────────
  RULE_WORLD_WRITABLE,
  RULE_INSECURE_TMP,
];
