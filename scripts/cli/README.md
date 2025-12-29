# Token Graveyard CLI

Modular command-line interface for interacting with the Token Graveyard smart contract.

## Overview

The CLI is organized into focused scripts for different operations:

| Script | Purpose | Example |
|--------|---------|---------|
| `info.js` | View contract state (read-only) | `npm run cli:info status` |
| `admin.js` | Administrative operations | `npm run cli:admin add-admin 0.0.12345` |
| `bury.js` | NFT burial (PERMANENT) | `npm run cli:bury stake 0.0.48486 1,2,3` |
| `associate.js` | Token association | `npm run cli:associate 0.0.48486` |
| `allowance.js` | Set allowances | `npm run cli:allowance nft 0.0.48486` |

## Quick Start

```bash
# Check contract status
npm run cli:info status

# Check your permissions
npm run cli:info is-admin 0.0.YOUR_ACCOUNT

# View associated tokens
npm run cli:info tokens
```

## Scripts

### info.js - View Contract State

Read-only operations that don't modify the contract.

```bash
# Full status overview (default)
node scripts/cli/info.js status

# Get cost configuration
node scripts/cli/info.js cost

# List associated tokens
node scripts/cli/info.js tokens

# List admins
node scripts/cli/info.js admins

# List contract users
node scripts/cli/info.js users

# Check if account is admin
node scripts/cli/info.js is-admin 0.0.12345

# Check if account is contract user
node scripts/cli/info.js is-user 0.0.12345

# Check if token is associated
node scripts/cli/info.js is-assoc 0.0.48486075
```

### admin.js - Administrative Operations

Requires admin role.

```bash
# Add an admin
node scripts/cli/admin.js add-admin 0.0.12345

# Remove an admin
node scripts/cli/admin.js remove-admin 0.0.12345

# Add a contract user
node scripts/cli/admin.js add-user 0.0.12345

# Remove a contract user
node scripts/cli/admin.js remove-user 0.0.12345

# Update cost configuration (cost, burn%)
node scripts/cli/admin.js set-cost 10 25

# Withdraw $LAZY tokens
node scripts/cli/admin.js withdraw-lazy 0.0.12345 1000

# Withdraw hbar (in tinybars)
node scripts/cli/admin.js withdraw-hbar 0.0.12345 100000000
```

### bury.js - NFT Burial (PERMANENT)

**WARNING: NFT burial is permanent and irreversible!**

```bash
# Direct send (no royalties, max 8 NFTs)
node scripts/cli/bury.js send 0.0.48486075 1,2,3

# Stake to bury (bypasses royalties, unlimited NFTs)
node scripts/cli/bury.js stake 0.0.48486075 1,2,3,4,5
```

### associate.js - Token Association

```bash
# Associate token (paid - charges $LAZY)
node scripts/cli/associate.js 0.0.48486075

# Associate token for free (admin/contract user only)
node scripts/cli/associate.js free 0.0.48486075
```

### allowance.js - Set Allowances

```bash
# Set $LAZY allowance to LazyGasStation
node scripts/cli/allowance.js lazy 100

# Set NFT allowance (all serials) to graveyard
node scripts/cli/allowance.js nft 0.0.48486075
```

## Global Options

All scripts support these options:

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format (for scripting/AI agents) |
| `--confirm` | Skip confirmation prompts (for automation) |
| `--help`, `-h` | Show help for the command |

## JSON Output Mode

For scripting and AI agent integration, use `--json`:

```bash
# Get status as JSON
node scripts/cli/info.js status --json

# Check admin status
node scripts/cli/info.js is-admin 0.0.12345 --json
```

JSON responses follow this structure:

```json
{
  "success": true,
  "timestamp": "2025-12-28T10:30:00.000Z",
  "data": { ... },
  "error": null
}
```

## Non-Interactive Mode

For CI/CD or scripting, combine `--json` and `--confirm`:

```bash
# Automated burial (DANGEROUS)
node scripts/cli/bury.js stake 0.0.48486 1,2,3 --json --confirm

# Automated admin operations
node scripts/cli/admin.js add-user 0.0.12345 --json --confirm
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |

## Typical Workflows

### First-Time User: Bury NFTs Without Royalties

```bash
# 1. Check cost
npm run cli:info cost

# 2. Set $LAZY allowance
node scripts/cli/allowance.js lazy 100

# 3. Bury NFTs (will auto-associate token if needed)
node scripts/cli/bury.js send 0.0.48486075 1,2,3
```

### First-Time User: Bury NFTs With Royalties

```bash
# 1. Check cost
npm run cli:info cost

# 2. Set $LAZY allowance (for association)
node scripts/cli/allowance.js lazy 100

# 3. Set NFT allowance (for staking)
node scripts/cli/allowance.js nft 0.0.48486075

# 4. Stake NFTs (bypasses royalties)
node scripts/cli/bury.js stake 0.0.48486075 1,2,3,4,5
```

### Admin: Setup New Token

```bash
# 1. Associate token for free
node scripts/cli/associate.js free 0.0.48486075

# 2. Verify association
node scripts/cli/info.js is-assoc 0.0.48486075
```

### Admin: Manage Roles

```bash
# View current admins
npm run cli:info admins

# Add new admin
node scripts/cli/admin.js add-admin 0.0.12345

# Add contract user (for ecosystem contracts)
node scripts/cli/admin.js add-user 0.0.67890
```

## Architecture

```
scripts/cli/
├── lib/
│   ├── client.js      # Hedera client setup
│   ├── format.js      # Output formatting (human/JSON)
│   └── contract.js    # Contract interaction helpers
├── info.js            # Read-only queries
├── admin.js           # Admin operations
├── bury.js            # NFT burial
├── associate.js       # Token association
├── allowance.js       # Allowance setup
└── README.md          # This file
```

## Environment Variables

Required in `.env`:

```env
ENVIRONMENT=TEST                          # TEST or MAIN
ACCOUNT_ID=0.0.YOUR_ACCOUNT               # Operator account
PRIVATE_KEY=YOUR_PRIVATE_KEY              # Operator key
GRAVEYARD_CONTRACT_ID=0.0.CONTRACT_ID     # Deployed graveyard
LAZY_TOKEN=0.0.LAZY_TOKEN_ID              # $LAZY token
LAZY_GAS_STATION_CONTRACT_ID=0.0.GAS_ID   # LazyGasStation
```

## Legacy Interactive CLI

The original interactive menu is still available:

```bash
npm run interact
```
