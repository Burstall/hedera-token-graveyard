# Token Graveyard v2.0

A permanent NFT storage solution on Hedera with royalty bypass capabilities.

## 🎯 Overview

Token Graveyard is a "trapdoor" smart contract that permanently stores NFTs. Once an NFT enters the graveyard, it can never be retrieved. Version 2.0 introduces:

- **Royalty Bypass**: Stake NFTs with royalties using HTS allowances to avoid royalty fees
- **Dual Pathways**: Direct send for NFTs without royalties, staking for NFTs with royalties
- **Role-Based Access**: Admin and ContractUser roles for flexible ecosystem integration
- **LazyGasStation Integration**: Centralized $LAZY payment and burn mechanism
- **Enhanced Events**: Clean, indexed events for easy tracking and UX integration

## 🏗️ Architecture

### Core Components

1. **TokenGraveyard.sol**: Main contract inheriting from TokenStaker
2. **TokenStaker.sol**: NFT staking module using HTS allowances
3. **LazyGasStation.sol**: Centralized payment handler for $LAZY tokens
4. **LazyDelegateRegistry.sol** (optional): NFT delegation management

### Inheritance Chain

```
TokenGraveyard
    ├─> TokenStaker
    │       ├─> HederaTokenService
    │       └─> Uses: LazyGasStation, LazyDelegateRegistry
    └─> IRoles (interface)
```

## 📋 Business Logic

### Two Pathways for Burial

#### 1. Direct Send via SDK (No Royalties)
- **Use Case**: NFTs without royalties attached
- **Method**: Hedera SDK `TransferTransaction` (no contract call needed)
- **Requirements**:
  - Token must be associated with graveyard first (via `associateToken()` or `associateTokenFree()`)
  - User transfers NFTs directly to graveyard address using Hedera SDK
- **Transfer Type**: Standard HTS transfer via SDK
- **Why No Contract Call?**: For no-royalty NFTs, there's no need for the allowance-based bypass mechanism

#### 2. Staking Send (With Royalties)
- **Use Case**: NFTs with royalties attached
- **Method**: `stakeNFTsToTheGrave(address tokenAddress, uint256[] memory serials)`
- **Requirements**:
  - User sets NFT allowance to graveyard contract
  - User pays nominal $LAZY cost (if not admin/contract user)
  - Token auto-associated if needed
  - Unlimited NFTs (batched in groups of 8)
- **Transfer Type**: HTS allowance-based transfer (bypasses royalties)
- **Why It Works**: Uses 1 tinybar allowance transfers that avoid triggering royalty fees

### Role System

#### Admin Role
- Add/remove other admins (cannot remove last admin)
- Add/remove contract users
- Update $LAZY cost and burn percentage
- Withdraw hbar and $LAZY from contract
- Associate tokens for free

#### ContractUser Role
- Associate tokens for free
- Stake NFTs on behalf of other users (for ecosystem contracts)
- Example: Token swap contract sends old NFTs to graveyard

#### Regular Users
- Pay nominal $LAZY cost to associate tokens
- Send/stake their own NFTs to graveyard

### Payment Flow

1. **User Action**: Calls graveyard method
2. **$LAZY Payment**: Graveyard calls `LazyGasStation.drawLazyFrom(user, amount, burnPercentage)`
3. **LazyGasStation**: Takes $LAZY from user allowance, burns percentage, keeps remainder
4. **NFT Transfer**: Graveyard completes NFT burial
5. **Event Emission**: `NFTsBuried` event fired with details

### Gas Management

- LazyGasStation holds pools of hbar and $LAZY
- TokenStaker's `refill()` modifier auto-refills from LazyGasStation when low
- Enables smooth staking operations without user gas concerns

## 🚀 Deployment

### Prerequisites

```bash
npm install
```

### Environment Variables

Create a `.env` file:

```env
# Network
ENVIRONMENT=TEST  # or MAIN

# Operator Account
ACCOUNT_ID=0.0.YOUR_ACCOUNT
PRIVATE_KEY=YOUR_PRIVATE_KEY

# Existing Contracts (if already deployed)
LAZY_CONTRACT=0.0.LAZY_SCT_CONTRACT_ID
LAZY_TOKEN=0.0.LAZY_TOKEN_ID
LAZY_GAS_STATION_CONTRACT_ID=0.0.GAS_STATION_ID
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.REGISTRY_ID  # Optional

# Configuration
LAZY_BURN_PERCENT=25  # Percentage of $LAZY payment to burn
LAZY_GRAVEYARD_COST=10  # Cost in $LAZY (before decimals)
LAZY_DECIMALS=1

# Test Accounts (optional - will auto-create if not specified)
ALICE_ACCOUNT_ID=
ALICE_PRIVATE_KEY=
BOB_ACCOUNT_ID=
BOB_PRIVATE_KEY=
```

### Deploy Contracts

```bash
# Deploy to testnet
npm run deploy

# Run tests
npm run test

# Interact with deployed contract
npm run interact
```

### Deployment Order

1. **LAZYTokenCreator** (if not exists): Mints $LAZY token
2. **LazyGasStation** (if not exists): Manages payments and gas
3. **LazyDelegateRegistry** (optional): Delegation management
4. **TokenGraveyard**: Main graveyard contract
5. **Configuration**:
   - Add graveyard as contract user to LazyGasStation
   - Fund LazyGasStation with hbar and $LAZY

## 💻 UX Implementation Guide

### For Regular Users

#### Scenario 1: Bury NFTs Without Royalties

```javascript
// 1. Ensure token is associated with graveyard (one-time per token)
//    Option A: Admin/ContractUser associates for free
await graveyardContract.associateTokenFree(nftTokenAddress);
//    Option B: Regular user pays $LAZY to associate
await setAllowance(lazyToken, lazyGasStation, lazyCost);
await graveyardContract.associateToken(nftTokenAddress);

// 2. Transfer NFTs directly to graveyard via Hedera SDK
const transferTx = new TransferTransaction()
    .addNftTransfer(nftTokenId, serial1, userAccountId, graveyardAccountId)
    .addNftTransfer(nftTokenId, serial2, userAccountId, graveyardAccountId);
await transferTx.execute(client);

// 3. NFTs are permanently stored (no contract call needed for transfer)
```

#### Scenario 2: Bury NFTs With Royalties (Avoid Fees)

```javascript
// 1. Set $LAZY allowance to LazyGasStation
await setAllowance(lazyToken, lazyGasStation, lazyCost);

// 2. Set NFT allowance to graveyard
await setNFTAllowanceAll(nftToken, graveyardContract);

// 3. Call staking method (bypasses royalties, auto-associates)
await graveyardContract.stakeNFTsToTheGrave(
    nftTokenAddress,
    [serial1, serial2, ..., serialN]  // Unlimited (batched)
);

// 4. NFTs are permanently stored, no royalties paid
```

### For Contract Users (Ecosystem Contracts)

```javascript
// Example: Token Swap Contract

// 1. User approves old NFTs to swap contract
// 2. Swap contract calls graveyard on behalf of user

await graveyardContract.stakeNFTsToTheGraveOnBehalf(
    oldNFTToken,
    [serial1, serial2],
    userAddress  // The actual owner
);

// 3. Swap contract gives user new NFTs
// 4. Old NFTs permanently stored in graveyard
```

### For Admins

```javascript
// Add contract user
await graveyardContract.addContractUser(swapContractAddress);

// Update costs
await graveyardContract.updateCost(newLazyCost, newBurnPercentage);

// Associate token for free
await graveyardContract.associateTokenFree(newNFTToken);

// Withdraw accumulated funds
await graveyardContract.withdrawLazy(treasuryAddress, amount);
await graveyardContract.withdrawHbar(treasuryAddress, amount);
```

### Monitoring Events

```javascript
// Listen for burial events
graveyardContract.on('NFTsBuried', (user, token, serials, viaStaking) => {
    console.log(`User ${user} buried ${serials.length} NFTs from ${token}`);
    console.log(`Method: ${viaStaking ? 'Staking' : 'Direct'}`);
});

// Listen for role changes
graveyardContract.on('RoleUpdated', (executor, target, role, added) => {
    console.log(`${executor} ${added ? 'added' : 'removed'} ${target} as ${role}`);
});
```

## 📝 Contract Methods

### Public Methods

#### Token Association
- `associateToken(address tokenAddress)`: Paid association for regular users
- `associateTokenFree(address tokenAddress)`: Free association for admins/contract users
- `batchAssociateTokens(address[] tokenAddresses)`: Batch free association

#### NFT Burial
- `stakeNFTsToTheGrave(address tokenAddress, uint256[] serials)`: Staking send for royalty NFTs (max 50, batched internally)
- `stakeNFTsToTheGraveOnBehalf(address tokenAddress, uint256[] serials, address onBehalfOf)`: Contract user stakes for others
- **Direct Send**: For no-royalty NFTs, use Hedera SDK `TransferTransaction` directly (no contract method needed)

#### Role Management
- `addAdmin(address admin)`: Add admin
- `removeAdmin(address admin)`: Remove admin
- `addContractUser(address contractUser)`: Add contract user
- `removeContractUser(address contractUser)`: Remove contract user

#### Admin Functions
- `updateCost(uint256 lazyCost, uint256 lazyBurnPercentage)`: Update costs
- `withdrawLazy(address receiver, uint256 amount)`: Withdraw $LAZY
- `withdrawHbar(address receiver, uint256 amount)`: Withdraw hbar

#### View Functions
- `getCost()`: Returns (lazyCost, lazyBurnPercentage)
- `isTokenAssociated(address tokenAddress)`: Check if token associated
- `getAssociatedTokens()`: Get all associated tokens
- `getAdmins()`: Get all admins
- `getContractUsers()`: Get all contract users
- `isAdmin(address account)`: Check if account is admin
- `isContractUser(address account)`: Check if account is contract user

## 🔒 Security Features

### Custom Errors
- Gas-efficient error handling
- Clear error messages for debugging
- Type-safe error parameters

### ReentrancyGuard
- Protects all state-changing functions
- Prevents re-entrancy attacks

### Role-Based Access Control
- EnumerableSet for efficient role management
- Cannot remove last admin
- Granular permissions

### NFT Trapping
- No withdrawal methods
- No delegate-back functionality
- Truly permanent storage

## 🧪 Testing

```bash
# Run full test suite
npm run test

# Specific test file
npx mocha test/TokenGraveyard.test.js
```

### Test Coverage

- ✅ Deployment and initialization
- ✅ Role management (add/remove admins and contract users)
- ✅ Access control enforcement
- ✅ Token association (paid and free)
- ✅ Staking NFT burial (royalty bypass)
- ✅ Batch processing (>8 NFTs)
- ✅ On-behalf staking (contract users)
- ✅ Admin functions (withdraw, update costs)
- ✅ Edge cases (empty arrays, zero serials, limits)

## 📊 Gas Estimates

| Operation | Gas Limit | Notes |
|-----------|-----------|-------|
| Deploy | 4,500,000 | Initial deployment |
| Associate Token (Paid) | 1,350,000 | BASE_GAS + ASSOCIATION_GAS |
| Associate Token (Free) | 1,350,000 | Admin/contract user |
| Stake NFTs | 2,500,000 | Up to 8 NFTs (royalty bypass) |
| Stake NFTs (Batch) | 3,500,000 | 9-50 NFTs |
| Update Cost | 400,000 | Admin function |
| Withdraw | 600,000 | $LAZY or hbar |
| Direct Send (SDK) | N/A | No contract gas - uses Hedera SDK |

## 🛠️ Scripts

### Decode Error
```bash
node scripts/decodeSmartContractError.js testnet 0.0.CONTRACT_ID
```

### Get Logs
```bash
npm run logs
```

### Solhint
```bash
npm run solhint
```

## 🌟 Use Cases

1. **Burn Old NFT Collections**: Project wants to permanently remove old/deprecated NFTs
2. **Token Swaps**: Upgrade mechanism where old NFTs are buried and new ones issued
3. **Community Cleanup**: Remove spam or unwanted NFTs from circulation
4. **Deflationary Mechanics**: Reduce total supply for scarcity
5. **Royalty Avoidance**: Move NFTs with high royalties without paying fees

## ⚠️ Important Notes

1. **Permanent Storage**: NFTs sent to graveyard can NEVER be retrieved
2. **No Delegation**: Delegation is hardcoded to false - NFTs are locked forever
3. **Cost Management**: Admins should monitor and adjust $LAZY costs as needed
4. **Gas Station Funding**: LazyGasStation must have sufficient hbar/$LAZY
5. **Allowances**: Users must set proper allowances before staking

## 📜 License

MIT

## 🤝 Contributing

Contributions welcome! Please test thoroughly before submitting PRs.

## 📞 Support

For issues or questions, please open a GitHub issue.

---

**Version**: 2.0  
**Author**: stowerling.eth / stowerling.hbar  
**Network**: Hedera Mainnet / Testnet
