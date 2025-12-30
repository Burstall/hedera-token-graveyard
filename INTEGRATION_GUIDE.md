# Integration Example

This directory shows how to use `@lazysuperheroes/token-graveyard` in your own project.

## Installation

```bash
npm install @lazysuperheroes/token-graveyard
npm install @openzeppelin/contracts  # peer dependency
```

## Solidity Integration

### Basic Usage (Interface Only)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "@lazysuperheroes/token-graveyard/contracts/interfaces/ITokenGraveyard.sol";

contract MyNFTManager {
    ITokenGraveyard public immutable graveyard;
    
    constructor(address graveyardAddress) {
        graveyard = ITokenGraveyard(graveyardAddress);
    }
    
    /// @notice Burn NFTs by sending them to the graveyard
    /// @dev User must have set NFT allowances to this contract
    function burnNFTs(
        address tokenAddress,
        uint256[] memory serials,
        address owner
    ) external {
        // Graveyard will pull NFTs from owner using allowances
        graveyard.stakeNFTsToTheGraveOnBehalf(tokenAddress, serials, owner);
    }
    
    /// @notice Check if a token is ready to use with graveyard
    function isTokenReady(address tokenAddress) external view returns (bool) {
        return graveyard.isTokenAssociated(tokenAddress);
    }
}
```

### Advanced Usage (Multiple Interfaces)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "@lazysuperheroes/token-graveyard/contracts/interfaces/ITokenGraveyard.sol";
import "@lazysuperheroes/token-graveyard/contracts/interfaces/ILazyGasStation.sol";

contract NFTSwapWithBurn {
    ITokenGraveyard public immutable graveyard;
    ILazyGasStation public immutable gasStation;
    
    address public constant NEW_TOKEN = 0x...;
    address public constant OLD_TOKEN = 0x...;
    
    constructor(address _graveyard, address _gasStation) {
        graveyard = ITokenGraveyard(_graveyard);
        gasStation = ILazyGasStation(_gasStation);
    }
    
    /// @notice Swap old NFTs for new ones, burning the old
    function swapAndBurn(uint256[] memory oldSerials) external {
        // 1. Transfer old NFTs to this contract (user must approve)
        // 2. Mint new NFTs to user
        // 3. Burn old NFTs via graveyard
        graveyard.stakeNFTsToTheGraveOnBehalf(OLD_TOKEN, oldSerials, msg.sender);
    }
}
```

## JavaScript/TypeScript Integration

### Deployment in Tests

```javascript
const { ethers } = require('hardhat');
const { TokenGraveyardABI } = require('@lazysuperheroes/token-graveyard');

describe("Integration Tests", function() {
    let graveyard;
    let myContract;
    
    beforeEach(async function() {
        // Deploy dependencies (you provide these)
        const lazyToken = await deployLazyToken();
        const gasStation = await deployGasStation(lazyToken.address);
        
        // Deploy TokenGraveyard from the package
        const TokenGraveyard = await ethers.getContractFactory(
            TokenGraveyardABI.abi,
            TokenGraveyardABI.bytecode
        );
        
        graveyard = await TokenGraveyard.deploy(
            lazyToken.address,
            gasStation.address,
            ethers.ZeroAddress,  // No delegate registry
            ethers.parseUnits("0", 8),  // Free for testing
            0  // No burn for testing
        );
        
        await graveyard.waitForDeployment();
        
        // Deploy your contract
        const MyContract = await ethers.getContractFactory("MyNFTManager");
        myContract = await MyContract.deploy(await graveyard.getAddress());
        
        // Grant your contract "ContractUser" role
        await graveyard.addContractUser(await myContract.getAddress());
    });
    
    it("should burn NFTs via graveyard", async function() {
        const [owner] = await ethers.getSigners();
        const nftAddress = await deployTestNFT();
        const serials = [1, 2, 3];
        
        // Mint NFTs to owner
        await mintNFTs(nftAddress, owner.address, serials);
        
        // Owner approves myContract to manage NFTs
        await setAllowance(nftAddress, owner, myContract.address, serials);
        
        // Burn via your contract
        await myContract.burnNFTs(nftAddress, serials, owner.address);
        
        // Verify NFTs are in graveyard
        const graveyardAddress = await graveyard.getAddress();
        for (const serial of serials) {
            const nftOwner = await getNFTOwner(nftAddress, serial);
            expect(nftOwner).to.equal(graveyardAddress);
        }
    });
});
```

### Direct Interaction

```javascript
const { ethers } = require('ethers');
const { TokenGraveyardABI } = require('@lazysuperheroes/token-graveyard');

async function interactWithGraveyard(provider, graveyardAddress) {
    const graveyard = new ethers.Contract(
        graveyardAddress,
        TokenGraveyardABI.abi,
        provider
    );
    
    // Check if token is associated
    const isAssociated = await graveyard.isTokenAssociated(nftAddress);
    console.log('Token associated:', isAssociated);
    
    // Get cost to use graveyard
    const [lazyCost, burnPercentage] = await graveyard.getCost();
    console.log('Cost:', ethers.formatUnits(lazyCost, 8), '$LAZY');
    console.log('Burn percentage:', burnPercentage, '%');
    
    // Get all associated tokens
    const tokens = await graveyard.getAssociatedTokens();
    console.log('Associated tokens:', tokens);
}
```

## Important Notes

### No Conflicts with Your HTS Code

If your project already uses Hedera precompiles:

```solidity
// Your project's HTS
import "./contracts/hedera/HederaTokenService.sol";

// Graveyard interface (no conflict - different paths)
import "@lazysuperheroes/token-graveyard/contracts/interfaces/ITokenGraveyard.sol";

contract MyContract is HederaTokenService {
    ITokenGraveyard public graveyard;
    
    // Both work independently - no clash
    function doMyThing() external {
        // Your HTS code
        tokenAssociate(someToken);
        
        // Graveyard interaction
        graveyard.stakeNFTsToTheGrave(someToken, serials);
    }
}
```

The key is **explicit import paths** - Solidity won't confuse them.

### Dependencies You Must Provide

When deploying TokenGraveyard, you must provide:

1. **$LAZY Token** - Your ERC20 token address
2. **LazyGasStation** - Contract implementing `ILazyGasStation` interface
3. **LazyDelegateRegistry** (optional) - Or `address(0)` if not used

See the package interfaces for required methods:
- `@lazysuperheroes/token-graveyard/contracts/interfaces/ILazyGasStation.sol`
- `@lazysuperheroes/token-graveyard/contracts/interfaces/ILazyDelegateRegistry.sol`

## Testing Your Integration

```bash
# In your project
npm test

# Example test command
npx hardhat test test/integration/graveyard.test.js
```

## Troubleshooting

### "Cannot find module '@lazysuperheroes/token-graveyard'"

Install the package and peer dependencies:
```bash
npm install @lazysuperheroes/token-graveyard @openzeppelin/contracts
```

### Solidity import errors

Make sure your `hardhat.config.js` or `foundry.toml` can resolve node_modules:

```javascript
// hardhat.config.js
module.exports = {
  solidity: "0.8.12",
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts"
  }
  // No special config needed - Hardhat auto-resolves node_modules
};
```

### Version conflicts

Check peer dependencies match:
```bash
npm list @openzeppelin/contracts
```

Should show version ^4.9.6. If different, update your project's OpenZeppelin version.
