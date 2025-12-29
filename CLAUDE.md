# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Token Graveyard is a "trapdoor" smart contract for permanently storing NFTs on Hedera. Once an NFT enters the graveyard, it can never be retrieved. Version 2.0 introduces royalty bypass via HTS allowance-based staking.

## Build & Development Commands

```bash
# Install dependencies
npm install

# Compile contracts (runs contract sizer and docgen on compile)
npm run compile

# Run all tests
npm run test

# Run specific test file
npm run test:graveyard
# or
npx hardhat test test/TokenGraveyard.test.js

# Deploy to network (uses ENVIRONMENT env var: TEST or MAIN)
npm run deploy

# Lint Solidity files
npm run solhint

# Get contract logs
npm run logs

# Decode smart contract error
npm run decode-error
# or with args: node scripts/decodeSmartContractError.js testnet 0.0.CONTRACT_ID
```

### CLI Tools

```bash
npm run cli:info       # Contract information
npm run cli:admin      # Admin operations
npm run cli:bury       # Bury NFTs
npm run cli:associate  # Token association
npm run cli:allowance  # Manage allowances
```

## Architecture

### Contract Inheritance Chain

```
TokenGraveyard (main contract)
    ├── TokenStaker (NFT staking with HTS allowances)
    │       └── HederaTokenServiceLite (HTS precompile wrapper)
    ├── IRoles (role interface)
    └── ReentrancyGuard (OpenZeppelin)

LazyGasStation (payment handler)
    ├── HederaTokenServiceLite
    ├── ILazyGasStation
    ├── IRoles
    └── ReentrancyGuard
```

### Core Contracts

- **TokenGraveyard.sol**: Main contract - handles NFT burial with two pathways (direct send for no-royalty NFTs, staking for royalty NFTs), role management, and cost configuration
- **TokenStaker.sol**: NFT staking module using HTS allowances to bypass royalties. Batches NFTs in groups of 8 per transaction. Uses `refill()` modifier to auto-refill hbar from LazyGasStation
- **LazyGasStation.sol**: Centralized $LAZY payment handler with burn mechanism. Manages hbar/LAZY refills and draws from user allowances
- **HederaTokenServiceLite.sol**: Lightweight HTS precompile wrapper for token operations

### Key Business Logic

**Two NFT Burial Pathways:**
1. Direct Send (no royalties): User sends NFTs directly via Hedera SDK after association
2. Staking Send (bypasses royalties): User sets NFT allowance, calls `stakeNFTsToTheGrave()` - uses 1 tinybar allowance transfers that avoid triggering royalty fees

**Role System:**
- Admin: Full access, add/remove roles, update costs, withdraw funds
- ContractUser: Free token association, stake NFTs on behalf of others (for ecosystem contracts)
- Regular users: Pay $LAZY cost for operations

**Max NFTs:** 50 per staking call (batched internally in groups of 8)

## Environment Configuration

Required `.env` variables:
- `ENVIRONMENT`: TEST or MAIN
- `ACCOUNT_ID`: Hedera account (format: 0.0.xxxxx)
- `PRIVATE_KEY`: DER-encoded hex private key
- `LAZY_TOKEN`: $LAZY token contract ID
- `LAZY_GAS_STATION_CONTRACT_ID`: LazyGasStation address
- `GRAVEYARD_CONTRACT_ID`: TokenGraveyard address (set after deployment)

## Solidity Configuration

- Solidity version: 0.8.18
- Optimizer: enabled, 200 runs
- viaIR: true
- Uses OpenZeppelin 4.7.3 (EnumerableSet, SafeCast, IERC20, ReentrancyGuard)

## Hedera-Specific Notes

- Contract uses HTS (Hedera Token Service) precompile at address 0x167
- Token association required before receiving tokens
- NFT transfers use `cryptoTransfer` with hbar transfer of 1 tinybar to satisfy royalty requirement while bypassing actual fees
- Response codes in HederaResponseCodes.sol map to HTS error codes

## Hedera Integration Testing

### SDK Requirements

Use `@hashgraph/sdk` v2.78.0+ for all API methods including `deleteTokenNftAllowanceAllSerials`.

### Mirror Node Patterns

**EVM Calls - Always pre-encode data:**
```javascript
async function readContract(iface, contractId, functionName, params = [], fromId = operatorId) {
    const encodedCommand = iface.encodeFunctionData(functionName, params);
    const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, fromId, false);
    const decoded = iface.decodeFunctionResult(functionName, result);
    return decoded.length === 1 ? decoded[0] : decoded;
}
```

**Entity Resolution:**
- Use `homebrewPopulateAccountEvmAddress(env, id, EntityType.TOKEN|CONTRACT|ACCOUNT)` for EVM addresses
- ECDSA accounts have different EVM addresses than Hedera-derived - always use mirror node lookup
- Use `homebrewPopulateAccountNum()` for reverse (EVM to Hedera ID)

**Royalty Detection:**
```javascript
const royaltyInfo = await checkTokenHasFallbackRoyalty(env, tokenId);
if (royaltyInfo.hasFallback) {
    // Use staking method to bypass royalties
} else {
    // Can transfer directly via SDK
}
```

### Gas Estimation

```javascript
const BASE_GAS = 400_000;
const ASSOCIATION_GAS_PER_TOKEN = 950_000;
// For token association: BASE_GAS + ASSOCIATION_GAS_PER_TOKEN
```

Use `estimateGas()` from `utils/gasHelpers.js` for dynamic estimation.

### Error Handling in Tests

**Do NOT use try/catch** - check result status instead:
```javascript
const result = await contractExecuteFunction(contractId, iface, client, gasLimit, 'functionName', [params]);
const status = result[0]?.status;
expect(status?.name === 'ExpectedErrorName' || status?.toString() !== 'SUCCESS').to.be.true;
```

Set up `global.errorInterfaces` with combined ABIs for custom error decoding across contract call chains.

### Critical Test Patterns

1. **Token Association Order**: Associate tokens BEFORE receiving them
2. **NFT Allowance Transfers**: Contract must set `isApproval = true` in HTS transfer struct
3. **LAZY Funding**: Use `sendLazy` from LAZYTokenCreator, not direct transfer
4. **FT Allowances**: Set allowance to LazyGasStation before calls requiring LAZY payment
5. **Mirror Node Delays**: Add `await sleep(4000)` after transactions before mirror node queries
6. **Test Timeouts**: Use `this.timeout(900000)` (15 min) for deployment tests on testnet
