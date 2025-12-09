# Releasing @framers/agentos

This document describes the release process for the AgentOS package.

---

## Release Process

Releases are **manual only** to prevent accidental version bumps. This ensures deliberate, tested releases.

### Prerequisites

1. All tests passing on `master` branch
2. CHANGELOG.md updated with release notes
3. `NPM_TOKEN` secret configured in GitHub repository settings

### Steps to Release

#### 1. Via GitHub Actions (Recommended)

1. Go to [Actions → Release](https://github.com/framersai/agentos/actions/workflows/release.yml)
2. Click **"Run workflow"**
3. Enter the version number (e.g., `0.2.0`, `1.0.0`, `0.2.0-beta.1`)
4. Optionally enable "Dry run" to test without publishing
5. Click **"Run workflow"**

The workflow will:
- Validate the version format
- Build and test the package
- Update `package.json` version
- Publish to npm
- Create a git tag
- Create a GitHub Release

#### 2. Manual Release (Local)

```bash
cd packages/agentos

# Ensure clean state
git checkout master
git pull origin master

# Run tests
pnpm test

# Build
pnpm build

# Update version
npm version 0.2.0 --no-git-tag-version

# Publish
npm publish --access public

# Commit and tag
git add package.json
git commit -m "chore(release): 0.2.0"
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin master --tags
```

---

## Versioning

We follow [Semantic Versioning](https://semver.org/):

| Change Type | Version Bump | Example |
|------------|--------------|---------|
| Bug fixes, patches | PATCH | `0.1.0` → `0.1.1` |
| New features (backward compatible) | MINOR | `0.1.1` → `0.2.0` |
| Breaking changes | MAJOR | `0.2.0` → `1.0.0` |
| Pre-release | PRERELEASE | `0.2.0-beta.1` |

### When to Bump

- **PATCH** — Bug fixes, documentation, internal refactors
- **MINOR** — New features, new APIs, deprecations (with warnings)
- **MAJOR** — Breaking API changes, removed features, major rewrites

---

## Pre-release Versions

For testing or beta releases:

```
0.2.0-alpha.1   # Early development
0.2.0-beta.1    # Feature complete, testing
0.2.0-rc.1      # Release candidate
```

To publish a pre-release:
1. Use version like `0.2.0-beta.1`
2. The GitHub Release will be marked as "pre-release" automatically

---

## Changelog

Update `CHANGELOG.md` before releasing:

```markdown
## [0.2.0] - 2024-12-10

### Features
- New planning engine API
- Added streaming support

### Fixes
- Fixed memory leak in GMI manager

### Breaking Changes
- Removed deprecated `oldMethod()` — use `newMethod()` instead
```

---

## Troubleshooting

### npm publish fails with 401

Ensure `NPM_TOKEN` is set in GitHub repository secrets:
1. Go to repository Settings → Secrets → Actions
2. Add `NPM_TOKEN` with your npm access token

### Version already exists

npm does not allow republishing the same version. Increment the version number.

### Tests failing in CI

Fix tests locally before releasing. Do not skip tests.

---

## Related

- [CONTRIBUTING.md](../CONTRIBUTING.md) — Development guidelines
- [CHANGELOG.md](../CHANGELOG.md) — Release history
- [GitHub Actions](https://github.com/framersai/agentos/actions) — CI/CD status


















