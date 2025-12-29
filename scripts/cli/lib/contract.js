/**
 * Contract Interaction Utilities
 * Wrapper around solidityHelpers for CLI usage
 */

const { ethers } = require('ethers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../../utils/solidityHelpers');
const { estimateGas } = require('../../../utils/gasHelpers');
const { homebrewPopulateAccountEvmAddress, EntityType } = require('../../../utils/hederaMirrorHelpers');
const { createClient, loadABI, validateGraveyardConfig } = require('./client');

// Default fallback gas limits for different operations
const GAS_LIMITS = {
	QUERY: 100_000,
	SIMPLE_ADMIN: 400_000,
	TOKEN_TRANSFER: 600_000,
	HTS_OPERATION: 800_000,
	DIRECT_BURIAL: 1_200_000,
	STAKING_BURIAL: 2_500_000,
};

/**
 * Create contract interface
 * @returns {{ iface: ethers.Interface, graveyardId: ContractId, client: Client, env: string, operatorId: AccountId }}
 */
function setupContract() {
	const { client, operatorId, env } = createClient();
	const { graveyardId } = validateGraveyardConfig();
	const abi = loadABI('TokenGraveyard');
	const iface = new ethers.Interface(abi);

	return {
		iface,
		graveyardId,
		client,
		env,
		operatorId,
	};
}

/**
 * Query contract (read-only via mirror node)
 * @param {string} functionName
 * @param {any[]} params
 * @returns {Promise<any>}
 */
async function queryContract(functionName, params = []) {
	const { iface, graveyardId, env, operatorId } = setupContract();

	const encodedCall = iface.encodeFunctionData(functionName, params);
	const result = await readOnlyEVMFromMirrorNode(
		env,
		graveyardId,
		encodedCall,
		operatorId,
		false,
	);

	return iface.decodeFunctionResult(functionName, result);
}

/**
 * Estimate gas for a contract function with fallback to default
 * @param {string} functionName
 * @param {any[]} params
 * @param {number} fallbackGas - Fallback gas limit if estimation fails
 * @returns {Promise<{ gasLimit: number, isEstimated: boolean }>}
 */
async function estimateContractGas(functionName, params = [], fallbackGas = GAS_LIMITS.HTS_OPERATION) {
	const { iface, graveyardId, env, operatorId } = setupContract();

	try {
		const gasInfo = await estimateGas(
			env,
			graveyardId,
			iface,
			operatorId,
			functionName,
			params,
			fallbackGas,
		);
		return gasInfo;
	}
	catch (err) {
		// Fallback if gas estimation completely fails
		console.log(`  Gas estimation unavailable, using fallback: ${fallbackGas.toLocaleString()}`);
		return {
			gasLimit: fallbackGas,
			isEstimated: false,
		};
	}
}

/**
 * Execute contract function
 * @param {string} functionName
 * @param {any[]} params
 * @param {number} gasLimit - Gas limit (if not provided, will estimate)
 * @param {boolean} useEstimation - Whether to try gas estimation first
 * @returns {Promise<{ status: string, result: any, record: any, gasInfo?: object }>}
 */
async function executeContract(functionName, params = [], gasLimit = GAS_LIMITS.HTS_OPERATION, useEstimation = true) {
	const { iface, graveyardId, client } = setupContract();

	// Try to estimate gas if requested
	let gasInfo = { gasLimit, isEstimated: false };
	if (useEstimation) {
		gasInfo = await estimateContractGas(functionName, params, gasLimit);
	}

	const [receipt, result, record] = await contractExecuteFunction(
		graveyardId,
		iface,
		client,
		gasInfo.gasLimit,
		functionName,
		params,
	);

	return {
		status: receipt?.status?.toString() || 'UNKNOWN',
		result,
		record,
		gasInfo,
	};
}

/**
 * Get cost configuration
 * @returns {Promise<{ lazyCost: string, lazyBurnPercentage: number }>}
 */
async function getCost() {
	const result = await queryContract('getCost', []);
	return {
		lazyCost: result.lazyCost.toString(),
		lazyBurnPercentage: Number(result.lazyBurnPercentage),
	};
}

/**
 * Check if address is admin
 * @param {string} address - Solidity address
 * @returns {Promise<boolean>}
 */
async function isAdmin(address) {
	const result = await queryContract('isAdmin', [address]);
	return result[0];
}

/**
 * Check if address is contract user
 * @param {string} address - Solidity address
 * @returns {Promise<boolean>}
 */
async function isContractUser(address) {
	const result = await queryContract('isContractUser', [address]);
	return result[0];
}

/**
 * Check if token is associated
 * @param {string} tokenAddress - Solidity address
 * @returns {Promise<boolean>}
 */
async function isTokenAssociated(tokenAddress) {
	const result = await queryContract('isTokenAssociated', [tokenAddress]);
	return result[0];
}

/**
 * Get all associated tokens
 * @returns {Promise<string[]>}
 */
async function getAssociatedTokens() {
	const result = await queryContract('getAssociatedTokens', []);
	return result[0];
}

/**
 * Get all admins
 * @returns {Promise<string[]>}
 */
async function getAdmins() {
	const result = await queryContract('getAdmins', []);
	return result[0];
}

/**
 * Get all contract users
 * @returns {Promise<string[]>}
 */
async function getContractUsers() {
	const result = await queryContract('getContractUsers', []);
	return result[0];
}

/**
 * Get graveyard contract address
 * @returns {Promise<string>} EVM address of graveyard
 */
async function getGraveyardAddress() {
	const { graveyardId } = validateGraveyardConfig();
	const { env } = createClient();
	return await homebrewPopulateAccountEvmAddress(env, graveyardId.toString(), EntityType.CONTRACT);
}

/**
 * Get graveyard contract ID
 * @returns {ContractId} Contract ID of graveyard
 */
function getGraveyardId() {
	const { graveyardId } = validateGraveyardConfig();
	return graveyardId;
}

/**
 * Get LazyGasStation contract address from graveyard contract
 * @returns {Promise<string>} Solidity address of LazyGasStation
 */
async function getLazyGasStationAddress() {
	const result = await queryContract('lazyGasStation', []);
	return result[0];
}

/**
 * Get LAZY token address from graveyard contract
 * @returns {Promise<string>} Solidity address of LAZY token
 */
async function getLazyTokenAddress() {
	const result = await queryContract('lazyToken', []);
	return result[0];
}

module.exports = {
	GAS_LIMITS,
	setupContract,
	queryContract,
	executeContract,
	estimateContractGas,
	getCost,
	isAdmin,
	isContractUser,
	isTokenAssociated,
	getAssociatedTokens,
	getAdmins,
	getContractUsers,
	getGraveyardAddress,
	getGraveyardId,
	getLazyGasStationAddress,
	getLazyTokenAddress,
};
