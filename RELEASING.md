# AgentOS Release Process

This package uses [semantic-release](https://semantic-release.gitbook.io) to publish versions and changelog entries automatically.

## Branch strategy

- `master` is the only active release branch.
- Any merge or direct push to `master` triggers `.github/workflows/release.yml`.
- Commits must follow the [Conventional Commits](https://www.conventionalcommits.org) spec. semantic-release inspects commit messages to determine whether to cut a patch, minor, or major release.
- If no release-worthy commits land on `master`, semantic-release exits without publishing a new version.

## Versioning rules

| Commit type        | Example message                   | Release impact             |
|--------------------|-----------------------------------|----------------------------|
| `fix:`             | `fix: handle null persona id`     | Patch release (x.y.z → x.y.z+1) |
| `feat:`            | `feat: add persona wizard`        | Minor release (x.y.z → x.y+1.0) |
| `feat!` / `fix!`   | `feat!: drop deprecated API`      | Major release (x.y.z → x+1.0.0) |
| `chore:` / `docs:` | `docs: clarify persona config`    | No version bump             |

Breaking changes can also be declared via a `BREAKING CHANGE:` footer.

## Publishing flow

1. Land Conventional Commit changes on `master` (prefer PRs).
2. GitHub Actions runs the release workflow:
   - Installs dependencies.
   - Builds the package (must succeed for publication).
   - Runs `semantic-release` with `release.config.js`.
3. semantic-release performs:
   - Version analysis and changelog generation.
   - npm publication to the public registry.
   - GitHub release & tag creation (`vX.Y.Z`).
   - Commits the updated `CHANGELOG.md` and `package.json` back to `master` with `chore(release): X.Y.Z [skip ci]`.

No manual `npm publish` commands are required.

## Manual releases

If you need to retry a failed release:

```bash
pnpm install
pnpm run build
npx semantic-release --dry-run   # inspect
npx semantic-release             # publishes for real
```

Only run manual releases from a clean checkout of `master`. The GitHub workflow is preferred because it guarantees the correct environment and credentials.

## Authentication

The workflow uses:

- `GITHUB_TOKEN` – automatically provided.
- `NPM_TOKEN` – must be stored as an Actions secret in the submodule repository (`Settings → Secrets and variables → Actions → New repository secret`).

Without `NPM_TOKEN`, publication will fail.

