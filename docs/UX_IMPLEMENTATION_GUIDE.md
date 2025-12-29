# Token Graveyard - Frontend Implementation Guide

A practical guide for implementing Token Graveyard in your frontend application.

## Table of Contents

1. [Overview](#overview)
2. [Contract Addresses](#contract-addresses)
3. [Two Burial Pathways](#two-burial-pathways)
4. [Prerequisites & Allowances](#prerequisites--allowances)
5. [Implementation Flows](#implementation-flows)
6. [Reading Contract State](#reading-contract-state)
7. [Listening to Events](#listening-to-events)
8. [Error Handling](#error-handling)
9. [Gas Estimates](#gas-estimates)
10. [UI/UX Recommendations](#uiux-recommendations)

---

## Overview

Token Graveyard permanently stores NFTs. Once buried, NFTs can **never** be retrieved. There are two ways to bury NFTs:

| Method | Use Case | Royalties Paid? | Contract Call? |
|--------|----------|-----------------|----------------|
| **Direct Send** | NFTs without royalties | N/A | No (SDK only) |
| **Staking** | NFTs with royalties | No (bypassed) | Yes |

---

## Contract Addresses

You'll need these contract addresses (get from backend/config):

```javascript
const CONTRACTS = {
  graveyard: '0.0.XXXXX',        // TokenGraveyard contract
  lazyGasStation: '0.0.XXXXX',   // LazyGasStation (for $LAZY payments)
  lazyToken: '0.0.XXXXX',        // $LAZY token
};
```

**Converting to EVM Address:**
```javascript
import { ContractId } from '@hashgraph/sdk';

const graveyardEvmAddress = ContractId.fromString(CONTRACTS.graveyard).toSolidityAddress();
// Returns: 0x000000000000000000000000000000000000XXXX
```

---

## Two Burial Pathways

### Decision Flow

```
User wants to bury NFT
        |
        v
Does NFT have royalties?
        |
    +---+---+
    |       |
   NO      YES
    |       |
    v       v
 Direct   Staking
  Send    Method
```

### How to Detect Royalties

Query the Hedera Mirror Node to check for custom fees:

```javascript
async function hasRoyalties(tokenId) {
  const response = await fetch(
    `https://mainnet.mirrornode.hedera.com/api/v1/tokens/${tokenId}`
  );
  const data = await response.json();

  // Check for royalty fees with fallback
  const royaltyFees = data.custom_fees?.royalty_fees || [];
  return royaltyFees.some(fee => fee.fallback_fee !== null);
}
```

---

## Prerequisites & Allowances

### For Staking Method (Royalty NFTs)

Users need to set **two allowances** before burying:

#### 1. $LAZY Allowance to LazyGasStation

```javascript
import { AccountAllowanceApproveTransaction } from '@hashgraph/sdk';

async function setLazyAllowance(client, userId, amount) {
  const tx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(
      CONTRACTS.lazyToken,           // $LAZY token ID
      userId,                         // User's account
      CONTRACTS.lazyGasStation,       // Spender: LazyGasStation
      amount                          // Amount to approve
    );

  await tx.execute(client);
}
```

#### 2. NFT Allowance to Graveyard

```javascript
import { AccountAllowanceApproveTransaction } from '@hashgraph/sdk';

async function setNftAllowance(client, userId, tokenId) {
  const tx = new AccountAllowanceApproveTransaction()
    .approveTokenNftAllowanceAllSerials(
      tokenId,                        // NFT token ID
      userId,                         // User's account (owner)
      CONTRACTS.graveyard             // Spender: Graveyard
    );

  await tx.execute(client);
}
```

### For Direct Send (No-Royalty NFTs)

Only need to ensure token is associated with graveyard (usually already done).

---

## Implementation Flows

### Flow 1: Bury NFTs WITH Royalties (Staking Method)

```javascript
import { ContractExecuteTransaction, ContractFunctionParameters } from '@hashgraph/sdk';
import { ethers } from 'ethers';

// Load ABI (from abi/TokenGraveyard.json)
const graveyardAbi = [...]; // Import from ABI file
const iface = new ethers.Interface(graveyardAbi);

async function buryNftsWithRoyalties(client, userId, tokenId, serials) {
  // Step 1: Get current cost
  const { lazyCost } = await getCost(); // See "Reading Contract State"

  // Step 2: Set $LAZY allowance (if not already set)
  await setLazyAllowance(client, userId, lazyCost);

  // Step 3: Set NFT allowance (if not already set)
  await setNftAllowance(client, userId, tokenId);

  // Step 4: Call stakeNFTsToTheGrave
  const tokenEvmAddress = TokenId.fromString(tokenId).toSolidityAddress();

  const tx = new ContractExecuteTransaction()
    .setContractId(CONTRACTS.graveyard)
    .setGas(2_500_000) // Use higher gas for batches > 8
    .setFunction(
      'stakeNFTsToTheGrave',
      new ContractFunctionParameters()
        .addAddress(tokenEvmAddress)
        .addUint256Array(serials)
    );

  const result = await tx.execute(client);
  const receipt = await result.getReceipt(client);

  return receipt.status.toString() === 'SUCCESS';
}
```

### Flow 2: Bury NFTs WITHOUT Royalties (Direct Send)

```javascript
import { TransferTransaction } from '@hashgraph/sdk';

async function buryNftsDirectly(client, userId, tokenId, serials) {
  // Step 1: Check if token is associated with graveyard
  const isAssociated = await isTokenAssociated(tokenId);

  if (!isAssociated) {
    // Associate token first (may require $LAZY payment for regular users)
    await associateToken(client, tokenId);
  }

  // Step 2: Transfer NFTs directly to graveyard
  const tx = new TransferTransaction();

  for (const serial of serials) {
    tx.addNftTransfer(
      tokenId,
      serial,
      userId,                    // From: user
      CONTRACTS.graveyard        // To: graveyard
    );
  }

  const result = await tx.execute(client);
  const receipt = await result.getReceipt(client);

  return receipt.status.toString() === 'SUCCESS';
}
```

### Flow 3: Associate Token (One-Time per Token)

```javascript
async function associateToken(client, tokenId) {
  const tokenEvmAddress = TokenId.fromString(tokenId).toSolidityAddress();

  // For regular users (costs $LAZY)
  const tx = new ContractExecuteTransaction()
    .setContractId(CONTRACTS.graveyard)
    .setGas(1_350_000)
    .setFunction(
      'associateToken',
      new ContractFunctionParameters()
        .addAddress(tokenEvmAddress)
    );

  await tx.execute(client);
}
```

---

## Reading Contract State

### Get Current Cost

```javascript
async function getCost() {
  const result = await readContract('getCost', []);
  return {
    lazyCost: result.lazyCost,           // Cost in $LAZY (with decimals)
    burnPercentage: result.lazyBurnPercentage  // % that gets burned
  };
}
```

### Check if Token is Associated

```javascript
async function isTokenAssociated(tokenId) {
  const tokenEvmAddress = TokenId.fromString(tokenId).toSolidityAddress();
  return await readContract('isTokenAssociated', [tokenEvmAddress]);
}
```

### Check User Roles

```javascript
async function isAdmin(userAddress) {
  return await readContract('isAdmin', [userAddress]);
}

async function isContractUser(userAddress) {
  return await readContract('isContractUser', [userAddress]);
}
```

### Get Associated Tokens (Paginated)

```javascript
async function getAssociatedTokens(offset = 0, limit = 50) {
  return await readContract('getAssociatedTokensPaginated', [offset, limit]);
}
```

### Helper: Read Contract via Mirror Node

```javascript
async function readContract(functionName, params) {
  const iface = new ethers.Interface(graveyardAbi);
  const encodedData = iface.encodeFunctionData(functionName, params);

  const response = await fetch(
    `https://mainnet.mirrornode.hedera.com/api/v1/contracts/call`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: encodedData,
        to: CONTRACTS.graveyard,
        estimate: false
      })
    }
  );

  const data = await response.json();
  const decoded = iface.decodeFunctionResult(functionName, data.result);
  return decoded.length === 1 ? decoded[0] : decoded;
}
```

---

## Listening to Events

### NFTsBuried Event

Emitted when NFTs are successfully buried via staking.

```javascript
// Event signature
event NFTsBuried(
  address indexed user,      // Who buried the NFTs
  address indexed token,     // NFT collection address
  uint256[] serials,         // Serial numbers buried
  bool viaStaking            // Always true for staking method
);

// Mirror Node query for events
async function getBurialEvents(fromTimestamp) {
  const response = await fetch(
    `https://mainnet.mirrornode.hedera.com/api/v1/contracts/${CONTRACTS.graveyard}/results/logs?topic0=0x...&timestamp=gte:${fromTimestamp}`
  );
  // Parse events using ethers
}
```

### TokenAssociated Event

```javascript
event TokenAssociated(
  address indexed executor,     // Who triggered association
  address indexed token,        // Token that was associated
  bool indexed paidAssociation  // true = user paid, false = free
);
```

### Other Events

- `RoleUpdated(executor, target, role, added)` - Admin/ContractUser changes
- `CostUpdated(executor, lazyCost, lazyBurnPercentage)` - Cost configuration changes

---

## Error Handling

### Custom Errors

The contract uses custom errors for gas efficiency. Decode them using the ABI:

| Error | Meaning | User Action |
|-------|---------|-------------|
| `PermissionDenied` | User lacks required role | Check if user is admin/contractUser |
| `EmptySerialArray` | No serials provided | Ensure array has items |
| `InvalidSerialNumber` | Serial is 0 | Remove zero from array |
| `TooManySerials` | More than 50 serials | Split into batches |
| `ZeroAddress` | Invalid address | Check token/user address |
| `AssociationFailed` | HTS association failed | Token may be frozen/paused |
| `NFTTransferFailed` | Transfer failed | Check allowances, ownership |

### Decoding Errors

```javascript
function decodeError(errorData) {
  const iface = new ethers.Interface(graveyardAbi);
  try {
    const decoded = iface.parseError(errorData);
    return {
      name: decoded.name,
      args: decoded.args
    };
  } catch {
    return { name: 'Unknown', args: [] };
  }
}
```

---

## Gas Estimates

| Operation | Gas Limit | Notes |
|-----------|-----------|-------|
| `associateToken` | 1,350,000 | Includes association overhead |
| `stakeNFTsToTheGrave` (1-8 NFTs) | 2,500,000 | |
| `stakeNFTsToTheGrave` (9-50 NFTs) | 3,500,000 | Batched internally |
| Direct SDK Transfer | N/A | No contract gas |

---

## UI/UX Recommendations

### Pre-Burial Checklist UI

Show users what's needed before they can bury:

```
[ ] Token has royalties? → Using staking method
[x] $LAZY allowance set (100 $LAZY approved)
[ ] NFT allowance set for this collection
[ ] Ready to bury!
```

### Confirmation Dialog

**Critical**: Make it absolutely clear that burial is permanent.

```
⚠️ PERMANENT ACTION

You are about to bury 5 NFTs from "Cool Collection":
- Serial #123
- Serial #456
- Serial #789
- Serial #1011
- Serial #1213

These NFTs will be PERMANENTLY locked in the graveyard.
They can NEVER be retrieved.

Cost: 100 $LAZY (50% will be burned)

[Cancel] [I Understand - Bury Forever]
```

### Progress States

```
1. Checking royalties...
2. Setting $LAZY allowance... (if needed)
3. Setting NFT allowance... (if needed)
4. Burying NFTs...
5. ✅ Complete! NFTs have been permanently buried.
```

### Role-Based UI

| User Role | Free Association | Can Bury on Behalf |
|-----------|------------------|-------------------|
| Regular | No ($LAZY cost) | No |
| ContractUser | Yes | Yes |
| Admin | Yes | Yes |

Show different UI paths based on `isAdmin()` and `isContractUser()`.

### Batch Handling

- Max 50 NFTs per transaction
- If user selects more, show: "Your NFTs will be buried in X batches"
- Show progress: "Burying batch 1 of 3..."

---

## Quick Reference: Function Signatures

```solidity
// Association
function associateToken(address tokenAddress) external;
function associateTokenFree(address tokenAddress) external; // Admin/ContractUser only
function isTokenAssociated(address tokenAddress) external view returns (bool);

// Burial
function stakeNFTsToTheGrave(address tokenAddress, uint256[] serials) external;
function stakeNFTsToTheGraveOnBehalf(address tokenAddress, uint256[] serials, address onBehalfOf) external;

// Cost
function getCost() external view returns (uint256 lazyCost, uint256 lazyBurnPercentage);

// Role Checks
function isAdmin(address account) external view returns (bool);
function isContractUser(address account) external view returns (bool);
```

---

## Files You'll Need

From the `abi/` folder:
- `TokenGraveyard.json` - Main contract ABI
- `LazyGasStation.json` - For $LAZY payment interactions (optional)

---

## Support

For questions about the contract behavior, see the main README.md or open a GitHub issue.
