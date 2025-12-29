/**
 * Hedera Client Configuration
 * Shared client initialization for all CLI scripts
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

/**
 * Create and configure Hedera client based on environment
 * @returns {{ client: Client, operatorId: AccountId, operatorKey: PrivateKey, env: string }}
 */
function createClient() {
	const env = process.env.ENVIRONMENT?.toUpperCase();

	if (!env || (env !== 'TEST' && env !== 'MAIN')) {
		throw new Error('ENVIRONMENT must be TEST or MAIN in .env file');
	}

	if (!process.env.PRIVATE_KEY || !process.env.ACCOUNT_ID) {
		throw new Error('PRIVATE_KEY and ACCOUNT_ID required in .env file');
	}

	const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

	const client = env === 'TEST'
		? Client.forTestnet()
		: Client.forMainnet();

	client.setOperator(operatorId, operatorKey);

	return {
		client,
		operatorId,
		operatorKey,
		env: env === 'TEST' ? 'testnet' : 'mainnet',
	};
}

/**
 * Get contract configuration from environment
 * @returns {{ graveyardId: ContractId | null, lazyTokenId: TokenId, lazyGasStationId: ContractId }}
 */
function getContractConfig() {
	const graveyardId = process.env.GRAVEYARD_CONTRACT_ID
		? ContractId.fromString(process.env.GRAVEYARD_CONTRACT_ID)
		: null;

	const lazyTokenId = process.env.LAZY_TOKEN
		? TokenId.fromString(process.env.LAZY_TOKEN)
		: null;

	const lazyGasStationId = process.env.LAZY_GAS_STATION_CONTRACT_ID
		? ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID)
		: null;

	return {
		graveyardId,
		lazyTokenId,
		lazyGasStationId,
	};
}

/**
 * Load contract ABI
 * @param {string} contractName - Name of the contract (e.g., 'TokenGraveyard')
 * @returns {any[]} ABI array
 */
function loadABI(contractName) {
	const artifactPath = path.join(
		__dirname,
		'..',
		'..',
		'..',
		'artifacts',
		'contracts',
		`${contractName}.sol`,
		`${contractName}.json`,
	);

	if (!fs.existsSync(artifactPath)) {
		throw new Error(`ABI not found: ${artifactPath}. Run 'npx hardhat compile' first.`);
	}

	const json = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
	return json.abi;
}

/**
 * Validate required environment for graveyard operations
 */
function validateGraveyardConfig() {
	const config = getContractConfig();

	if (!config.graveyardId) {
		throw new Error('GRAVEYARD_CONTRACT_ID not set in .env. Run deploy first.');
	}

	if (!config.lazyTokenId) {
		throw new Error('LAZY_TOKEN not set in .env');
	}

	if (!config.lazyGasStationId) {
		throw new Error('LAZY_GAS_STATION_CONTRACT_ID not set in .env');
	}

	return config;
}

/**
 * Initialize global error interfaces for decoding errors from multiple contracts
 * This should be called at script startup before any contract interactions
 * @param {string[]} contractNames - Array of contract names to load (e.g., ['TokenGraveyard', 'LazyGasStation'])
 * @returns {ethers.Interface[]} Array of loaded interfaces
 */
function initErrorInterfaces(contractNames = ['TokenGraveyard', 'LazyGasStation']) {
	const interfaces = [];

	for (const name of contractNames) {
		try {
			const abi = loadABI(name);
			const iface = new ethers.Interface(abi);
			interfaces.push(iface);
		}
		catch (err) {
			// Contract may not exist - skip silently
			console.warn(`Warning: Could not load ABI for ${name}: ${err.message}`);
		}
	}

	// Set global error interfaces for solidityHelpers to use
	global.errorInterfaces = interfaces;

	return interfaces;
}

module.exports = {
	createClient,
	getContractConfig,
	loadABI,
	validateGraveyardConfig,
	initErrorInterfaces,
};
