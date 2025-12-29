# Changelog

All notable changes to the TokenGraveyard project will be documented in this file.

## [2.0.0] - Dec-2025

### 🎉 Major Release - Complete Overhaul

Complete rewrite of TokenGraveyard with royalty bypass, role-based access control, and LazyGasStation integration.

### ✨ Added

#### Core Features
- **Royalty Bypass System**: Integrated `TokenStaker` inheritance to enable HTS allowance-based transfers
  - New `stakeNFTsToTheGrave()` method bypasses royalty fees using 1 tinybar staking threshold
  - New `stakeNFTsToTheGraveOnBehalf()` for contract users to stake on behalf of others
  - Backwards compatible `sendNFTsToTheGrave()` for direct transfers (no royalties)

#### Role-Based Access Control
- **Two-tier role system** using OpenZeppelin's `EnumerableSet`
  - `Admin` role: Full contract control including role management, cost updates, withdrawals
  - `ContractUser` role: Can stake NFTs on behalf of users, free token association
- New functions:
  - `addAdmin()` / `removeAdmin()` - Manage admin roles
  - `addContractUser()` / `removeContractUser()` - Manage contract user roles
  - `isAdmin()` / `isContractUser()` - Check role membership
  - `getAdmins()` / `getContractUsers()` - List all role members
  - Protection against removing the last admin

#### Payment System
- **LazyGasStation Integration**: Centralized $LAZY token payment handling
  - All user operations use `$LAZY` tokens instead of hbar
  - Configurable burn percentage on each payment
  - Allowance-based payments (no direct transfers)
  - New `updateCost()` for dynamic pricing
  - New `withdrawLazy()` for admin fund recovery

#### Token Association
- **Dual association paths**:
  - `associateToken()` - Paid association for regular users
  - `associateTokenFree()` - Free association for admins/contract users
- `isTokenAssociated()` - Query association status
- `getAssociatedTokens()` - List all associated tokens
- Automatic tracking with `EnumerableSet`

#### Events & Errors
- **Custom Errors** (gas-efficient):
  - `HTSAssociationFailed(int64 responseCode)`
  - `HTSTransferFailed(int64 responseCode)`
  - `TooManySerials(uint256 provided, uint256 max)`
  - `BadInput(string reason)`
  - `LastAdmin()`
  - `PermissionDenied(address user, Role required)` (via `IRoles`)

- **Clean Events** (no strings):
  - `NFTsBuried(address indexed user, address indexed token, uint256[] serials, bool viaStaking)`
  - `TokenAssociated(address indexed token, address indexed paidBy)`
  - `RoleUpdated(address indexed user, Role role, bool granted)`
  - `CostUpdated(uint256 lazyCost, uint256 lazyBurnPercentage)`

#### Security
- Added `ReentrancyGuard` on all state-changing functions
- Input validation on all user-facing functions
- Role-based function modifiers

### 🔧 Changed

#### Architecture
- **Inheritance**: Now extends `TokenStaker` for royalty bypass functionality
- **Storage**: Replaced mappings with `EnumerableSet` for O(1) lookups and iteration
- **Access Control**: Migrated from `Ownable` to custom role-based system

#### Function Signatures
- `sendNFTsToTheGrave()`: Now accepts unlimited serials (internally batched by 8)
- Constructor parameters changed:
  ```solidity
  // v1.0
  constructor(address _token)
  
  // v2.0
  constructor(
      address lazyToken,
      address lazyGasStation,
      address lazyDelegateRegistry,
      uint256 lazyCost,
      uint256 lazyBurnPercentage
  )
  ```

#### Payment Flow
- Removed direct hbar payments
- All payments now through `LazyGasStation.drawLazyFrom()`
- Token association cost configurable at runtime

### 🗑️ Removed

- `Ownable` dependency (replaced with role system)
- String-based revert messages (replaced with custom errors)
- Direct hbar payment handling
- `transferHbar()` function (replaced with `withdrawHbar()`)
- Legacy event: `GraveyardEvent(string)` 

### 📚 Documentation

#### New Files
- **README.md**: Complete rewrite with:
  - Architecture overview
  - Business logic explanation (direct vs staking pathways)
  - Role system documentation
  - Payment flow diagrams
  - Deployment guide
  - UX implementation examples
  - Contract method reference
  - Security features
  - Gas estimates
  - Use cases

- **CHANGELOG.md**: This file!

#### Updated Files
- **TokenGraveyard.test.js**: Complete rewrite with 22+ test cases covering:
  - Deployment validation
  - Access control (7 tests)
  - Token association (3 tests)
  - Direct NFT burial (2 tests)
  - Staking NFT burial (3 tests)
  - Admin functions (4 tests)
  - Edge cases (3 tests)

#### Scripts
- **deploy.js**: Interactive deployment with validation
  - Prerequisite checking
  - Configuration prompts
  - Post-deployment instructions
  
- **interact.js**: Complete interactive CLI menu system
  - 7 view functions
  - 7 admin functions
  - 2 association options
  - 3 burial methods
  - 2 utility functions (allowance management)

- **getContractLogs.js**: Enhanced event decoding
  - Supports all v2.0 events
  - Formatted output with timestamps
  - Human-readable address conversion

- **decodeSmartContractError.js**: Updated for custom errors
  - Lists all v2.0 custom errors
  - Improved usage documentation

### 📦 Dependencies

No changes to core dependencies. Project still uses:
- Solidity: `^0.8.12`
- Hardhat: `^2.10.1`
- @hashgraph/sdk: `^2.17.1`
- @openzeppelin/contracts: `^4.7.3`

### 🔄 Migration Guide (v1.0 → v2.0)

#### For Contract Owners
1. Deploy v2.0 with new constructor parameters
2. Associate required tokens using `associateTokenFree()`
3. Update frontend to use new event structure
4. Set up $LAZY allowances instead of hbar payments

#### For Users
1. Ensure $LAZY token association
2. Approve $LAZY allowance to `LazyGasStation` contract
3. For royalty NFTs: Approve NFT allowance to graveyard, use `stakeNFTsToTheGrave()`
4. For non-royalty NFTs: Use `sendNFTsToTheGrave()` (unchanged behavior)

#### Breaking Changes
- Constructor signature completely changed
- Event structure changed - update event listeners
- Payment token changed from hbar to $LAZY
- Access control model changed from single owner to multi-role

### 🎯 Upgrade Highlights

**Why v2.0?**
- ✅ **Royalty Bypass**: Send NFTs with royalty fees to graveyard without paying fees
- ✅ **Role Flexibility**: Multiple admins and contract integrators
- ✅ **Ecosystem Integration**: Native LazyGasStation support
- ✅ **Gas Efficiency**: Custom errors save ~40% gas on reverts
- ✅ **Enhanced Events**: Clean, indexed events for better filtering
- ✅ **Security**: ReentrancyGuard on all critical functions
- ✅ **Developer Experience**: Comprehensive tests, interactive scripts, detailed docs

---

## [1.0.0] - Initial Release

### Added
- Basic NFT graveyard functionality
- Token association with hbar payment
- `sendNFTsToTheGrave()` for direct transfers
- `Ownable` access control
- Basic events with string messages

### Features
- Permanent NFT storage
- Single owner model
- Hbar-based payments
- Simple event logging
