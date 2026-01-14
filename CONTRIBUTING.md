# Contributing to cc-sessions

Thanks for your interest in contributing! This guide will help you get started.

## Quick Start

```bash
# Clone and setup
git clone https://github.com/iam-dev/cc-sessions.git
cd cc-sessions
npm install

# Build and test
npm run build
npm test
```

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run all tests |
| `npm run lint` | Check code style |

### Project Layout

```
cc-sessions/
├── src/
│   ├── parser/          # JSONL parsing & extraction
│   ├── store/           # SQLite database & search
│   ├── config/          # Configuration loading
│   ├── types.ts         # TypeScript interfaces
│   └── index.ts         # Public exports
├── hooks/               # Session lifecycle hooks
├── commands/            # Slash command definitions
├── tests/               # Jest test files
└── templates/           # Default config templates
```

### Code Style

- TypeScript strict mode
- `const` over `let`
- Explicit return types on public functions
- No `any` - use `unknown` if needed

### Naming

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `session-store.ts` |
| Classes | PascalCase | `SessionStore` |
| Functions | camelCase | `parseLogFile` |
| Constants | UPPER_SNAKE | `DEFAULT_CONFIG` |

## Pull Requests

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes and add tests
3. Run `npm test` and `npm run build`
4. Push and open a PR

### Commit Messages

```
feat: add new feature
fix: fix bug
docs: update documentation
test: add tests
refactor: refactor code
```

## Testing

```bash
# All tests
npm test

# With coverage
npm test -- --coverage

# Single file
npm test -- tests/parser/jsonl.test.ts
```

## Feature Ideas

- [ ] Cloud sync (S3/R2)
- [ ] Session comparison
- [ ] HTML/CSV export
- [ ] Team sessions
- [ ] Analytics dashboard

## Reporting Issues

Include:
- Node.js version
- OS
- Steps to reproduce
- Expected vs actual behavior

## License

Contributions are MIT licensed.
