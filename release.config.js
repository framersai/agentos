module.exports = {
  branches: ['master'],
  repositoryUrl: 'https://github.com/framersai/agentos',
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    ['@semantic-release/npm', { npmPublish: true }],
    ['@semantic-release/github', { assets: [] }],
    ['@semantic-release/git', {
      assets: ['CHANGELOG.md', 'package.json'],
      message: 'chore(release): ${nextRelease.version} [skip ci]'
    }]
  ]
};


