/**
 * Semantic Release Configuration
 *
 * Automates versioning and releases based on Conventional Commits:
 * - fix: → patch (0.1.0 → 0.1.1)
 * - feat: → minor (0.1.0 → 0.2.0)
 * - feat!: or BREAKING CHANGE: → major (0.1.0 → 1.0.0)
 * - perf:, refactor: → patch
 * - docs:, chore:, test:, ci: → no release
 */
export default {
  branches: ['master'],
  repositoryUrl: 'https://github.com/framersai/agentos',
  tagFormat: 'v${version}',
  plugins: [
    // Analyze commits to determine release type
    ['@semantic-release/commit-analyzer', {
      preset: 'conventionalcommits',
      releaseRules: [
        { type: 'feat', release: 'minor' },
        { type: 'fix', release: 'patch' },
        { type: 'perf', release: 'patch' },
        { type: 'refactor', release: 'patch' },
        { type: 'revert', release: 'patch' },
        { breaking: true, release: 'major' },
        // These don't trigger releases: docs, style, chore, test, ci, build
      ],
      parserOpts: {
        noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING']
      }
    }],

    // Generate release notes from commits
    ['@semantic-release/release-notes-generator', {
      preset: 'conventionalcommits',
      presetConfig: {
        types: [
          { type: 'feat', section: 'Features' },
          { type: 'fix', section: 'Bug Fixes' },
          { type: 'perf', section: 'Performance' },
          { type: 'refactor', section: 'Code Refactoring' },
          { type: 'revert', section: 'Reverts' },
          { type: 'docs', section: 'Documentation', hidden: true },
          { type: 'chore', section: 'Maintenance', hidden: true },
          { type: 'test', section: 'Tests', hidden: true },
          { type: 'ci', section: 'CI/CD', hidden: true },
          { type: 'build', section: 'Build', hidden: true },
        ]
      }
    }],

    // Update CHANGELOG.md
    ['@semantic-release/changelog', {
      changelogFile: 'CHANGELOG.md'
    }],

    // Publish to npm
    ['@semantic-release/npm', {
      npmPublish: true
    }],

    // Commit version bump and changelog
    ['@semantic-release/git', {
      assets: ['CHANGELOG.md', 'package.json'],
      message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
    }],

    // Create GitHub release
    ['@semantic-release/github', {
      successComment: false,
      failComment: false,
      releasedLabels: false
    }]
  ]
};
