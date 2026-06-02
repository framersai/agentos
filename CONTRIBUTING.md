# Contributing to AgentOS

Thanks for your interest. AgentOS is Apache-2.0. Pull requests are welcome for bug fixes, documentation, tests, examples, features, and new provider integrations.

## Ways to contribute

- Report bugs or request features in [Issues](https://github.com/framerslab/agentos/issues).
- Fix bugs, improve documentation, or add examples.
- Add a new LLM provider. Read the [provider integration guide](docs/contributing/new-provider.md) first: it covers the interface, the acceptance checklist, and the bar a provider PR must clear.
- Improve tests and benchmarks.

## Development setup

```bash
git clone https://github.com/framerslab/agentos.git && cd agentos
pnpm install
pnpm build
pnpm test
```

Run the targeted tests for the area you changed before opening a PR. CI runs the full suite.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`. Keep the subject in the imperative mood and focused on one change.

## Pull requests

- Keep each PR focused on one concern.
- Include tests and documentation for any change in behavior.
- Make sure `pnpm build` and the relevant tests pass. CI must be green.
- Complete the checklist in the PR template.

## Licensing of contributions

AgentOS is Apache-2.0. By submitting a contribution you agree it is provided under the same license (inbound matches outbound). Sign your commits with `git commit -s` (DCO) where you can.

## Provider neutrality

Provider support is decided on technical merit alone. The provider list is ordered neutrally and inclusion is free for everyone who meets the bar. Placement, ordering, and prominence are not for sale and are never part of a merge decision.

If your company wants promotion, featured placement, or a logo in the README, that is sponsorship, and it is handled separately and disclosed. See [SPONSORS.md](SPONSORS.md). A provider integration and a sponsorship are tracked independently: one does not depend on the other.

## Maintainers

Current maintainers are listed in [MAINTAINERS.md](MAINTAINERS.md). Reviews are routed through [.github/CODEOWNERS](.github/CODEOWNERS); a review from any one maintainer can approve a change.

## Code of Conduct

By participating you agree to the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately. See the [Security Policy](.github/SECURITY.md).

## Contact

Questions: team@frame.dev or [frame.dev](https://frame.dev).
