# Releasing @framers/agentos

> Last updated: 2024-12-10

This document describes the release process for the AgentOS package.

---

## Automated Releases

Releases are **fully automated** using [semantic-release](https://semantic-release.gitbook.io/). When you push commits to `master`, the release workflow analyzes your commit messages and automatically:

1. Determines the next version number
2. Generates release notes
3. Updates CHANGELOG.md
4. Publishes to npm
5. Creates a GitHub Release with the tag

### How It Works

The version bump is determined by your commit messages following [Conventional Commits](https://www.conventionalcommits.org/):

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `fix:` | Patch | `0.1.0` → `0.1.1` |
| `feat:` | Minor | `0.1.0` → `0.2.0` |
| `feat!:` or `BREAKING CHANGE:` | Major | `0.1.0` → `1.0.0` |
| `perf:` | Patch | `0.1.0` → `0.1.1` |
| `refactor:` | Patch | `0.1.0` → `0.1.1` |
| `docs:`, `chore:`, `ci:`, `test:` | No release | — |

### Commit Message Examples

```bash
# Patch release (0.1.0 → 0.1.1)
git commit -m "fix: resolve memory leak in GMI manager"

# Minor release (0.1.0 → 0.2.0)
git commit -m "feat: add streaming support for tool calls"

# Major release (0.1.0 → 1.0.0)
git commit -m "feat!: redesign AgentOS initialization API

BREAKING CHANGE: The initialize() method now requires a config object instead of positional arguments."

# No release triggered
git commit -m "docs: update README examples"
git commit -m "chore: update dependencies"
git commit -m "ci: fix workflow permissions"
```

---

## Prerequisites

For automated releases to work, ensure these secrets are configured in the repository:

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | npm authentication for publishing |
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions |

To set up `NPM_TOKEN`:
1. Go to [npmjs.com](https://www.npmjs.com/) → Access Tokens → Generate New Token
2. Choose "Automation" type
3. Go to repo Settings → Secrets → Actions → New repository secret
4. Name: `NPM_TOKEN`, Value: your token

---

## Manual Release (Optional)

You can also trigger a release manually with a dry-run option:

1. Go to [Actions → Release](https://github.com/framersai/agentos/actions/workflows/release.yml)
2. Click **"Run workflow"**
3. (Optional) Check "Dry run" to see what would be released without publishing
4. Click **"Run workflow"**

---

## Troubleshooting

### "No release published"

This means semantic-release didn't find any commits that trigger a release. Only `feat:`, `fix:`, `perf:`, `refactor:`, and `revert:` commits trigger releases.

### npm publish fails with 401

Ensure `NPM_TOKEN` is set correctly:
1. Verify the token hasn't expired
2. Verify the token has publish permissions
3. Check the token is for the correct npm account

### Version already exists

If a version was partially published, you may need to:
1. Manually delete the git tag: `git push --delete origin v0.1.1`
2. Re-run the release workflow

---

## Release Configuration

The release behavior is configured in `release.config.js`:

```javascript
// Commit types that trigger releases
releaseRules: [
  { type: 'feat', release: 'minor' },
  { type: 'fix', release: 'patch' },
  { type: 'perf', release: 'patch' },
  { type: 'refactor', release: 'patch' },
  { type: 'revert', release: 'patch' },
  { breaking: true, release: 'major' },
]
```

---

## Related

- [Conventional Commits](https://www.conventionalcommits.org/) — Commit message format
- [Semantic Release](https://semantic-release.gitbook.io/) — Release automation
- [CHANGELOG.md](../CHANGELOG.md) — Release history
- [GitHub Actions](https://github.com/framersai/agentos/actions) — CI/CD status
