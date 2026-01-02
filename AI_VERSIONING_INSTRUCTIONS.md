# Versioning Instructions

**CRITICAL:** Do NOT manually edit `package.json` to change the version number.

To update the version, ALWAYS use the npm CLI:

```bash
npm version patch   # For bug fixes (1.0.0 -> 1.0.1)
npm version minor   # For new features (1.0.0 -> 1.1.0)
npm version major   # For breaking changes (1.0.0 -> 2.0.0)
```

This ensures:
1. `package.json` and `package-lock.json` are updated.
2. A git commit and tag are created.
3. The `postversion` script runs (`git push --follow-tags`) to sync with the remote repository.
