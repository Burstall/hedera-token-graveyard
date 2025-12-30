/**
 * @lazysuperheroes/token-graveyard
 * 
 * Permanent NFT storage contract for Hedera with royalty bypass capabilities.
 * 
 * @example
 * // Import ABIs for deployment/interaction
 * const { TokenGraveyardABI, TokenStakerABI } = require('@lazysuperheroes/token-graveyard');
 * 
 * @example
 * // Import in Solidity (use direct paths)
 * import "@lazysuperheroes/token-graveyard/contracts/interfaces/ITokenGraveyard.sol";
 */

// Export ABIs for JavaScript/TypeScript usage
const TokenGraveyardABI = require('./abi/TokenGraveyard.json');
const TokenStakerABI = require('./abi/TokenStaker.json');

module.exports = {
	TokenGraveyardABI,
	TokenStakerABI,

	// Version info
	version: require('./package.json').version,
};
