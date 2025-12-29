# Hedera Integration Test Design Notes

Comprehensive notes for designing and writing Hedera smart contract integration tests.

## Table of Contents
1. [SDK Version Requirements](#sdk-version-requirements)
2. [Mirror Node EVM Calls](#mirror-node-evm-calls)
3. [Mirror Node Entity Resolution](#mirror-node-entity-resolution)
4. [Token Details and Royalty Detection](#token-details-and-royalty-detection)
5. [Gas Estimation](#gas-estimation)
6. [Error Handling Patterns](#error-handling-patterns)
7. [Token Operations](#token-operations)
8. [NFT Transfers with Allowances](#nft-transfers-with-allowances)
9. [Test Setup Patterns](#test-setup-patterns)
10. [Contract Deployment](#contract-deployment)

---

## SDK Version Requirements

Always use the latest `@hashgraph/sdk` version to ensure all API methods are available:

```bash
npm install @hashgraph/sdk@latest
```

**Important SDK features by version:**
- `deleteTokenNftAllowanceAllSerials` - requires SDK v2.78.0+
- `TokenNftAllowance` improvements - v2.70.0+

---

## Mirror Node EVM Calls

### Correct Pattern for `readOnlyEVMFromMirrorNode`

The function signature is:
```javascript
readOnlyEVMFromMirrorNode(env, contractId, encodedData, fromId, estimate)
```

**WRONG - Do not do this:**
```javascript
// Passing interface and function name directly - INCORRECT
const result = await readOnlyEVMFromMirrorNode(
    env,
    contractId,
    iface,        // WRONG - interface is not encodedData
    'functionName',
    [params],
    false
);
```

**CORRECT - Encode data first:**
```javascript
// Create a helper function for clean usage
async function readContract(iface, contractId, functionName, params = [], fromId = operatorId) {
    const encodedCommand = iface.encodeFunctionData(functionName, params);
    const result = await readOnlyEVMFromMirrorNode(
        env,
        contractId,
        encodedCommand,  // Pre-encoded data
        fromId,
        false,           // estimate = false for actual call
    );
    const decoded = iface.decodeFunctionResult(functionName, result);
    return decoded.length === 1 ? decoded[0] : decoded;
}

// Usage
const isAdmin = await readContract(graveyardIface, graveyardId, 'isAdmin', [address]);
```

---

## Mirror Node Entity Resolution

### EntityType Enum

Use the `EntityType` enum to specify what type of entity you're querying:

```javascript
const { EntityType } = require('../utils/hederaMirrorHelpers');

// Available types
EntityType.ACCOUNT   // 'accounts'
EntityType.TOKEN     // 'tokens'
EntityType.CONTRACT  // 'contracts'
```

### Getting EVM Address from Hedera ID

Use `homebrewPopulateAccountEvmAddress` to get the correct EVM address from the mirror node:

```javascript
const { homebrewPopulateAccountEvmAddress, EntityType } = require('../utils/hederaMirrorHelpers');

// With explicit entity type (preferred - faster)
const tokenEvmAddress = await homebrewPopulateAccountEvmAddress(
    env,
    '0.0.12345',
    EntityType.TOKEN
);

const contractEvmAddress = await homebrewPopulateAccountEvmAddress(
    env,
    contractId.toString(),
    EntityType.CONTRACT
);

// Without entity type (tries all types - slower)
const evmAddress = await homebrewPopulateAccountEvmAddress(env, '0.0.12345');
```

**Why use this instead of `toSolidityAddress()`?**
- Accounts with ECDSA keys have different EVM addresses than their Hedera-derived address
- The mirror node returns the actual EVM address used on the network
- Falls back to `toSolidityAddress()` if mirror node query fails

### Converting EVM Address to Hedera ID

Use `homebrewPopulateAccountNum` for the reverse operation:

```javascript
const { homebrewPopulateAccountNum, EntityType } = require('../utils/hederaMirrorHelpers');

// Convert EVM address back to Hedera ID
const hederaId = await homebrewPopulateAccountNum(
    env,
    '0x1234567890abcdef...',
    EntityType.ACCOUNT
);
// Returns: '0.0.12345'
```

---

## Token Details and Royalty Detection

### Getting Token Details

```javascript
const { getTokenDetails } = require('../utils/hederaMirrorHelpers');

const tokenInfo = await getTokenDetails(env, tokenId);
// Returns:
// {
//     symbol: 'NFT',
//     name: 'My NFT Collection',
//     decimals: 0,
//     total_supply: 100,
//     max_supply: 1000,
//     treasury_account_id: '0.0.12345',
//     type: 'NON_FUNGIBLE_UNIQUE',
//     custom_fees: { ... }  // Includes royalty fees
// }
```

### Checking for Fallback Royalties

Use `checkTokenHasFallbackRoyalty` to detect if an NFT has royalty fees with fallback:

```javascript
const { checkTokenHasFallbackRoyalty } = require('../utils/hederaMirrorHelpers');

const royaltyInfo = await checkTokenHasFallbackRoyalty(env, tokenId);
// Returns:
// {
//     hasFallback: true,
//     fallbackFees: [
//         {
//             collector_account_id: '0.0.12345',
//             numerator: 500,
//             denominator: 10000,
//             fallback_fee: { amount: 500000000, ... }  // 5 HBAR
//         }
//     ],
//     royaltyFees: [ ... ]  // All royalty fees
// }
```

**Use case: Context-aware NFT transfers**
```javascript
const royaltyInfo = await checkTokenHasFallbackRoyalty(env, tokenId);

if (royaltyInfo.hasFallback) {
    // NFT has fallback royalties - use staking method to bypass
    await stakeNFTsToTheGrave(tokenAddress, serials);
} else {
    // No fallback royalties - can transfer directly via SDK
    await TransferTransaction().addNftTransfer(...).execute(client);
}
```

---

## Gas Estimation

### Using gasHelpers.js

Import the gas estimation utility:
```javascript
const { estimateGas } = require('../utils/gasHelpers');
```

Create a helper function:
```javascript
async function getGasEstimate(iface, contractId, functionName, params = [], fallbackGas = BASE_GAS, valueTinybar = 0) {
    const gasInfo = await estimateGas(
        env,
        contractId,
        iface,
        operatorId,
        functionName,
        params,
        fallbackGas,
        valueTinybar  // Value in tinybars for payable functions
    );
    return gasInfo.gasLimit;
}
```

### Gas Constants

```javascript
const BASE_GAS = 400_000;                  // Standard contract call
const ASSOCIATION_GAS_PER_TOKEN = 950_000; // Extra gas per token association
```

### Token Association Gas

When a contract associates a token, add 950,000 gas per token:
```javascript
const gasLimit = BASE_GAS + ASSOCIATION_GAS_PER_TOKEN;
// For multiple tokens: BASE_GAS + (ASSOCIATION_GAS_PER_TOKEN * tokenCount)
```

---

## Error Handling Patterns

### Expecting Errors - CORRECT Pattern

**WRONG - Do not use try/catch:**
```javascript
// This pattern does NOT work correctly with Hedera SDK
try {
    await contractExecuteFunction(...);
    expect.fail('Should have failed');
} catch (err) {
    expect(err instanceof StatusError).to.be.true;
}
```

**CORRECT - Check result status:**
```javascript
const result = await contractExecuteFunction(
    contractId,
    iface,
    client,
    gasLimit,
    'functionName',
    [params]
);

const status = result[0]?.status;
expect(
    status?.name === 'ExpectedErrorName' ||
    status?.toString().includes('REVERT') ||
    status?.toString() !== 'SUCCESS'
).to.be.true;

console.log('Error caught - status:', status?.name || status?.toString());
```

### Custom Error Names

The `status?.name` property contains the custom error selector name (e.g., `PermissionDenied`, `TooManySerials`, `EmptySerialsArray`).

### Global Error Interfaces

Set up `global.errorInterfaces` for comprehensive error decoding:
```javascript
// Combine ABIs from all contracts
const allAbis = [
    ...mainContractJson.abi,
    ...helperContractJson.abi,
    ...tokenContractJson.abi,
];
global.errorInterfaces = new ethers.utils.Interface(allAbis);
```

This allows `contractExecuteFunction` to decode custom errors from any contract in the call chain.

---

## Token Operations

### Token Association Order

**Critical: Associate tokens BEFORE receiving them:**
```javascript
// WRONG order
await sendNFT(client, aliceId, bobId, tokenId, serials);  // Bob doesn't have token - FAILS
await associateTokensToAccount(client, bobId, bobPK, [tokenId]);

// CORRECT order
await associateTokensToAccount(client, bobId, bobPK, [tokenId]);  // Associate first
await sendNFT(client, aliceId, bobId, tokenId, serials);          // Then send
```

### LAZY Token Funding

When using LazyGasStation, ensure it has LAZY tokens:
```javascript
// Use sendLazy from LAZYTokenCreator instead of direct transfer
await contractExecuteFunction(
    lazySCT,
    lazyIface,
    client,
    400000,
    'sendLazy',
    [lazyGasStationAddress, amountWithDecimal]
);
```

### FT Allowances for Gas Station

Set FT allowance before contract calls that require LAZY payment:
```javascript
const lazyGasStationAccountId = AccountId.fromString(lazyGasStationId.toString());
await setFTAllowance(client, lazyTokenId, userId, lazyGasStationAccountId, amount);
```

---

## NFT Transfers with Allowances

### Contract-Side: isApproval Flag

When a contract transfers NFTs on behalf of a user (via allowance), the HTS transfer must include `isApproval = true`:

```solidity
// In Solidity contract
nftTransfer.senderAccountID = senderAddress;
nftTransfer.receiverAccountID = receiverAddress;
nftTransfer.serialNumber = int64(serials[i].toInt256());
nftTransfer.isApproval = true;  // CRITICAL: Use approved allowance from sender
```

### Test-Side: Setting NFT Allowances

```javascript
// Set NFT allowance for all serials
const graveyardAccountId = AccountId.fromString(graveyardId.toString());
await setNFTAllowanceAll(client, [tokenId], ownerId, graveyardAccountId);
```

---

## Test Setup Patterns

### Environment Variables

```javascript
// Required in .env
PRIVATE_KEY=...
ACCOUNT_ID=...
ENVIRONMENT=testnet  // or mainnet, local
LAZY_DECIMALS=1
LAZY_GRAVEYARD_COST=10
LAZY_BURN_PERC=25
```

### Mirror Node Delays

Add sleep after transactions before checking mirror node:
```javascript
const result = await contractExecuteFunction(...);
expect(result[0]?.status.toString()).to.equal('SUCCESS');
await sleep(4000);  // Wait for mirror node to update

const balance = await checkMirrorBalance(env, address, tokenId);
```

### Test Timeouts

Set appropriate timeouts for deployment and complex operations:
```javascript
describe('Deployment: ', function () {
    it('Should deploy...', async function () {
        this.timeout(900000);  // 15 minutes for testnet
        // ...
    });
});
```

---

## Contract Deployment

### Deployment Pattern

```javascript
const json = JSON.parse(fs.readFileSync('./artifacts/contracts/Contract.sol/Contract.json'));
const iface = new ethers.utils.Interface(json.abi);
const bytecode = json.bytecode;

const [contractId, contractAddress] = await contractDeployFunction(
    client,
    bytecode,
    6_000_000,  // Gas limit
    new ContractFunctionParameters()
        .addAddress(param1Address)
        .addAddress(param2Address)
);
```

### Contract ID to Account ID Conversion

When a contract needs to receive tokens or hbar:
```javascript
const contractAccountId = AccountId.fromString(contractId.toString());
await sendHbar(client, operatorId, contractAccountId, amount, HbarUnit.Hbar);
```

---

## Summary Checklist

Before running tests, verify:

- [ ] SDK version is latest (v2.78.0+)
- [ ] `readOnlyEVMFromMirrorNode` uses pre-encoded data
- [ ] Gas estimates use `gasHelpers.js`
- [ ] Token associations add 950,000 gas per token
- [ ] Error expectations use result status, not try/catch
- [ ] `global.errorInterfaces` includes all contract ABIs
- [ ] Tokens are associated before receiving
- [ ] `isApproval = true` set in contract for allowance-based NFT transfers
- [ ] LazyGasStation is funded with LAZY tokens
- [ ] Mirror node delays (4000ms) after transactions
- [ ] Appropriate test timeouts set
