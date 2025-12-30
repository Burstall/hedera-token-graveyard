# Publishing Guide

## Prerequisites

1. **NPM Account**: Create one at [npmjs.com](https://www.npmjs.com/signup)
2. **Login**: `npm login`
3. **Verify**: `npm whoami`

## Pre-Publish Checklist

### 1. Update Version
```bash
# Patch (2.1.0 → 2.1.1) - Bug fixes
npm version patch

# Minor (2.1.0 → 2.2.0) - New features, backward compatible
npm version minor

# Major (2.1.0 → 3.0.0) - Breaking changes
npm version major
```

### 2. Verify Package Contents
```bash
# Dry run to see what will be published
npm pack --dry-run

# Expected files:
# - contracts/*.sol (core contracts + interfaces)
# - abi/TokenGraveyard.json
# - abi/TokenStaker.json
# - README.md
# - INTEGRATION_GUIDE.md
# - index.js
# - package.json
```

### 3. Test the Package Locally

**In this repo:**
```bash
npm pack
# Creates: lazysuperheroes-token-graveyard-2.1.0.tgz
```

**In a test project:**
```bash
npm install /path/to/hedera-token-graveyard/lazysuperheroes-token-graveyard-2.1.0.tgz

# Test import in Solidity
# import "@lazysuperheroes/token-graveyard/contracts/interfaces/ITokenGraveyard.sol";
```

### 4. Ensure Clean Build
```bash
npm run compile
npm run test

# All tests should pass
```

### 5. Update Documentation
- [ ] README.md updated with latest features
- [ ] CHANGELOG.md updated with version notes
- [ ] INTEGRATION_GUIDE.md reflects any API changes

## Publishing

### First Time Setup

**Scope your package:**
```bash
# Already configured in package.json as:
# "@lazysuperheroes/token-graveyard"

# Make sure you have access to the @lazysuperheroes scope
# Or publish as unscoped: "token-graveyard"
```

### Publish to NPM

```bash
# Public package (recommended for open source)
npm publish --access public

# Private package (requires paid NPM account)
npm publish --access restricted
```

### Verify Publication

```bash
# Check on NPM
npm view @lazysuperheroes/token-graveyard

# Install in another project
npm install @lazysuperheroes/token-graveyard
```

## Alternative: GitHub Packages

If you don't want to use NPM's public registry:

### 1. Update package.json
```json
{
  "name": "@burstall/token-graveyard",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

### 2. Authenticate
```bash
# Create GitHub Personal Access Token with 'write:packages' scope
npm login --registry=https://npm.pkg.github.com
```

### 3. Publish
```bash
npm publish
```

### 4. Consumers Install
```bash
# Add .npmrc to consuming project:
# @burstall:registry=https://npm.pkg.github.com

npm install @burstall/token-graveyard
```

## Version Management Strategy

### Semantic Versioning (semver)

**MAJOR.MINOR.PATCH** (e.g., 2.1.0)

- **PATCH** (2.1.0 → 2.1.1): Bug fixes, gas optimizations, documentation
  - Contract functionality unchanged
  - Safe to update without testing
  
- **MINOR** (2.1.0 → 2.2.0): New features, backward compatible
  - New functions added
  - Existing functions unchanged
  - Recommended to test before upgrading
  
- **MAJOR** (2.1.0 → 3.0.0): Breaking changes
  - Function signatures changed
  - Events modified
  - Requires full integration testing and contract redeployment

### Tagging Strategy

```bash
# After publishing, tag the release
git tag -a v2.1.0 -m "Release v2.1.0"
git push origin v2.1.0

# Create GitHub release with changelog
```

## Post-Publish

1. **Update dependent projects**
   ```bash
   # In consuming projects
   npm update @lazysuperheroes/token-graveyard
   ```

2. **Announce the release**
   - GitHub release notes
   - Discord/Twitter/community channels
   - Update project documentation

3. **Monitor issues**
   - Watch NPM downloads
   - Respond to GitHub issues
   - Address integration problems

## Unpublishing (Emergency Only)

```bash
# Only within 72 hours and if no dependents
npm unpublish @lazysuperheroes/token-graveyard@2.1.0

# Better: deprecate instead
npm deprecate @lazysuperheroes/token-graveyard@2.1.0 "Critical bug, use v2.1.1 instead"
```

## Common Issues

### "You do not have permission to publish"
- Verify you're logged in: `npm whoami`
- Check scope ownership: `npm owner ls @lazysuperheroes/token-graveyard`
- Add yourself: `npm owner add <username> @lazysuperheroes/token-graveyard`

### "Package name too similar to existing package"
- Change package name in package.json
- Or add scope: `@yourusername/token-graveyard`

### "Missing files in published package"
- Check `files` field in package.json
- Run `npm pack --dry-run` to preview
- Verify .npmignore isn't excluding too much

## Testing Checklist Before v1.0.0

- [ ] Package installs successfully
- [ ] Solidity imports work in test project
- [ ] JavaScript ABIs load correctly
- [ ] Integration tests pass in consuming project
- [ ] Documentation is clear and accurate
- [ ] All peer dependencies documented
- [ ] Examples compile and run

## Ready to Publish!

```bash
# Final check
npm run compile && npm run test

# Version bump
npm version minor  # or patch/major

# Publish
npm publish --access public

# Tag release
git push && git push --tags

# 🎉 Done!
```
