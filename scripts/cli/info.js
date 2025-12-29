#!/usr/bin/env node
/**
 * Token Graveyard Info Script
 * View contract state without making any changes
 *
 * Usage:
 *   node scripts/cli/info.js [command] [options]
 *
 * Commands:
 *   status              Full contract status overview
 *   cost                Get cost configuration
 *   tokens              List all associated tokens
 *   admins              List all admins
 *   users               List all contract users
 *   is-admin <account>  Check if account is admin
 *   is-user <account>   Check if account is contract user
 *   is-assoc <token>    Check if token is associated
 *
 * Options:
 *   --json              Output in JSON format
 *   --quiet, -q         Minimal output
 *   --help, -h          Show help
 */

const { AccountId, TokenId, ContractId } = require('@hashgraph/sdk');
const {
	homebrewPopulateAccountEvmAddress,
	homebrewPopulateAccountNum,
	EntityType,
	getTokenDetails,
} = require('../../utils/hederaMirrorHelpers');
const { createClient, validateGraveyardConfig } = require('./lib/client');
const {
	initOutputMode,
	isJsonMode,
	createResponse,
	output,
	header,
	row,
	table,
	info,
	error,
} = require('./lib/format');
const {
	getCost,
	isAdmin,
	isContractUser,
	isTokenAssociated,
	getAssociatedTokens,
	getAdmins,
	getContractUsers,
	getLazyGasStationAddress,
	getLazyTokenAddress,
} = require('./lib/contract');

// Initialize output mode
initOutputMode();

/**
 * Show help
 */
function showHelp() {
	console.log(`
Token Graveyard Info - View Contract State

Usage:
  node scripts/cli/info.js [command] [options]

Commands:
  status              Full contract status overview (default)
  cost                Get cost configuration
  tokens              List all associated tokens
  admins              List all admins
  users               List all contract users
  is-admin <account>  Check if account is admin (e.g., 0.0.12345)
  is-user <account>   Check if account is contract user
  is-assoc <token>    Check if token is associated

Options:
  --json              Output in JSON format (for scripting)
  --quiet, -q         Minimal output
  --help, -h          Show this help

Examples:
  node scripts/cli/info.js status
  node scripts/cli/info.js tokens --json
  node scripts/cli/info.js is-admin 0.0.12345
  node scripts/cli/info.js is-assoc 0.0.48486075 --json
`);
}

/**
 * Convert EVM address to Hedera ID string (best effort)
 * @param {string} evmAddress
 * @param {string} env
 * @param {string} entityType
 * @returns {Promise<string>}
 */
async function evmToHederaId(evmAddress, env, entityType) {
	try {
		const hederaId = await homebrewPopulateAccountNum(env, evmAddress, entityType);
		return hederaId;
	}
	catch (err) {
		// Fallback to SDK conversion
		try {
			if (entityType === EntityType.TOKEN) {
				return TokenId.fromSolidityAddress(evmAddress).toString();
			}
			else if (entityType === EntityType.CONTRACT) {
				return ContractId.fromSolidityAddress(evmAddress).toString();
			}
			else {
				return AccountId.fromSolidityAddress(evmAddress).toString();
			}
		}
		catch (sdkErr) {
			// Return EVM address as fallback
			return evmAddress;
		}
	}
}

/**
 * Full status overview
 */
async function showStatus() {
	const { operatorId, env } = createClient();
	const { graveyardId } = validateGraveyardConfig();

	// Get EVM addresses
	const operatorAddress = await homebrewPopulateAccountEvmAddress(env, operatorId.toString(), EntityType.ACCOUNT);
	const graveyardAddress = await homebrewPopulateAccountEvmAddress(env, graveyardId.toString(), EntityType.CONTRACT);

	// Fetch all data in parallel
	const [
		costData,
		admins,
		users,
		tokens,
		operatorIsAdmin,
		operatorIsUser,
		lazyGasStationAddress,
		lazyTokenAddress,
	] = await Promise.all([
		getCost(),
		getAdmins(),
		getContractUsers(),
		getAssociatedTokens(),
		isAdmin(operatorAddress),
		isContractUser(operatorAddress),
		getLazyGasStationAddress(),
		getLazyTokenAddress(),
	]);

	// Convert EVM addresses to Hedera IDs
	const lazyGasStationId = await evmToHederaId(lazyGasStationAddress, env, EntityType.CONTRACT);
	const lazyTokenId = await evmToHederaId(lazyTokenAddress, env, EntityType.TOKEN);

	// Get LAZY token details to scale cost by decimals
	const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
	const scaledLazyCost = lazyTokenInfo?.decimals
		? Number(costData.lazyCost) / (10 ** lazyTokenInfo.decimals)
		: costData.lazyCost;

	if (isJsonMode()) {
		output(createResponse(true, {
			network: env,
			operator: operatorId.toString(),
			contract: {
				id: graveyardId.toString(),
				evmAddress: graveyardAddress,
			},
			lazyToken: {
				id: lazyTokenId,
				evmAddress: lazyTokenAddress,
				decimals: lazyTokenInfo?.decimals,
			},
			lazyGasStation: {
				id: lazyGasStationId,
				evmAddress: lazyGasStationAddress,
			},
			operatorRole: {
				isAdmin: operatorIsAdmin,
				isContractUser: operatorIsUser,
			},
			cost: {
				lazyCost: scaledLazyCost,
				lazyCostRaw: costData.lazyCost,
				lazyBurnPercentage: costData.lazyBurnPercentage,
			},
			counts: {
				admins: admins.length,
				contractUsers: users.length,
				associatedTokens: tokens.length,
			},
		}, null, { network: env }));
		return;
	}

	header('Token Graveyard Status');

	console.log('\n  Environment');
	row('Network', env.toUpperCase());
	row('Operator', operatorId.toString());

	console.log('\n  Graveyard Contract');
	row('Contract ID', graveyardId.toString());
	row('EVM Address', graveyardAddress);

	console.log('\n  Ecosystem Contracts (from contract state)');
	row('$LAZY Token', lazyTokenId);
	row('  EVM Address', lazyTokenAddress);
	row('  Decimals', lazyTokenInfo?.decimals || 'Unknown');
	row('LazyGasStation', lazyGasStationId);
	row('  EVM Address', lazyGasStationAddress);

	console.log('\n  Your Permissions');
	row('Admin', operatorIsAdmin ? 'Yes' : 'No');
	row('Contract User', operatorIsUser ? 'Yes' : 'No');

	console.log('\n  Cost Configuration');
	row('$LAZY Cost', `${scaledLazyCost} $LAZY (${costData.lazyCost} raw)`);
	row('Burn Percentage', `${costData.lazyBurnPercentage}%`);
	row('Net to Treasury', `${100 - costData.lazyBurnPercentage}%`);

	console.log('\n  Summary');
	row('Total Admins', admins.length.toString());
	row('Total Contract Users', users.length.toString());
	row('Associated Tokens', tokens.length.toString());

	console.log('');
}

/**
 * Show cost configuration
 */
async function showCost() {
	const { env } = createClient();
	const costData = await getCost();

	// Get LAZY token address and details to scale cost
	const lazyTokenAddress = await getLazyTokenAddress();
	const lazyTokenId = await evmToHederaId(lazyTokenAddress, env, EntityType.TOKEN);
	const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
	const scaledLazyCost = lazyTokenInfo?.decimals
		? Number(costData.lazyCost) / (10 ** lazyTokenInfo.decimals)
		: costData.lazyCost;

	if (isJsonMode()) {
		output(createResponse(true, {
			lazyCost: scaledLazyCost,
			lazyCostRaw: costData.lazyCost,
			lazyBurnPercentage: costData.lazyBurnPercentage,
			lazyToken: {
				id: lazyTokenId,
				decimals: lazyTokenInfo?.decimals,
			},
		}));
		return;
	}

	header('Cost Configuration');
	row('$LAZY Token', lazyTokenId);
	row('  Decimals', lazyTokenInfo?.decimals || 'Unknown');
	row('$LAZY Cost', `${scaledLazyCost} $LAZY (${costData.lazyCost} raw)`);
	row('Burn Percentage', `${costData.lazyBurnPercentage}%`);
	row('Net to Treasury', `${100 - costData.lazyBurnPercentage}%`);
	console.log('');
}

/**
 * List associated tokens
 */
async function showTokens() {
	const { env } = createClient();
	const tokens = await getAssociatedTokens();

	if (isJsonMode()) {
		const formatted = await Promise.all(tokens.map(async (addr) => {
			const tokenId = await evmToHederaId(addr, env, EntityType.TOKEN);
			return {
				tokenId: tokenId,
				evmAddress: addr,
			};
		}));
		output(createResponse(true, { count: tokens.length, tokens: formatted }));
		return;
	}

	header(`Associated Tokens (${tokens.length})`);

	if (tokens.length === 0) {
		info('No tokens associated yet.');
		return;
	}

	const rows = await Promise.all(tokens.map(async (addr, i) => {
		const tokenId = await evmToHederaId(addr, env, EntityType.TOKEN);
		return [i + 1, tokenId, addr];
	}));

	table(['#', 'Token ID', 'EVM Address'], rows);
	console.log('');
}

/**
 * List admins
 */
async function showAdmins() {
	const { env } = createClient();
	const admins = await getAdmins();

	if (isJsonMode()) {
		const formatted = await Promise.all(admins.map(async (addr) => {
			const accountId = await evmToHederaId(addr, env, EntityType.ACCOUNT);
			return {
				accountId: accountId,
				evmAddress: addr,
			};
		}));
		output(createResponse(true, { count: admins.length, admins: formatted }));
		return;
	}

	header(`Admins (${admins.length})`);

	if (admins.length === 0) {
		info('No admins found (unexpected!).');
		return;
	}

	const rows = await Promise.all(admins.map(async (addr, i) => {
		const accountId = await evmToHederaId(addr, env, EntityType.ACCOUNT);
		return [i + 1, accountId, addr];
	}));

	table(['#', 'Account ID', 'EVM Address'], rows);
	console.log('');
}

/**
 * List contract users
 */
async function showUsers() {
	const { env } = createClient();
	const users = await getContractUsers();

	if (isJsonMode()) {
		const formatted = await Promise.all(users.map(async (addr) => {
			const contractId = await evmToHederaId(addr, env, EntityType.CONTRACT);
			return {
				contractId: contractId,
				evmAddress: addr,
			};
		}));
		output(createResponse(true, { count: users.length, contractUsers: formatted }));
		return;
	}

	header(`Contract Users (${users.length})`);

	if (users.length === 0) {
		info('No contract users registered.');
		return;
	}

	const rows = await Promise.all(users.map(async (addr, i) => {
		const contractId = await evmToHederaId(addr, env, EntityType.CONTRACT);
		return [i + 1, contractId, addr];
	}));

	table(['#', 'Contract ID', 'EVM Address'], rows);
	console.log('');
}

/**
 * Check if account is admin
 * @param {string} accountIdStr
 */
async function checkIsAdmin(accountIdStr) {
	const { env } = createClient();
	const evmAddress = await homebrewPopulateAccountEvmAddress(env, accountIdStr, EntityType.ACCOUNT);
	const result = await isAdmin(evmAddress);

	if (isJsonMode()) {
		output(createResponse(true, {
			accountId: accountIdStr,
			evmAddress: evmAddress,
			isAdmin: result,
		}));
		return;
	}

	header('Admin Check');
	row('Account', accountIdStr);
	row('EVM Address', evmAddress);
	row('Is Admin', result ? 'Yes' : 'No');
	console.log('');
}

/**
 * Check if account is contract user
 * @param {string} contractIdStr
 */
async function checkIsUser(contractIdStr) {
	const { env } = createClient();
	const evmAddress = await homebrewPopulateAccountEvmAddress(env, contractIdStr, EntityType.CONTRACT);
	const result = await isContractUser(evmAddress);

	if (isJsonMode()) {
		output(createResponse(true, {
			contractId: contractIdStr,
			evmAddress: evmAddress,
			isContractUser: result,
		}));
		return;
	}

	header('Contract User Check');
	row('Contract', contractIdStr);
	row('EVM Address', evmAddress);
	row('Is Contract User', result ? 'Yes' : 'No');
	console.log('');
}

/**
 * Check if token is associated
 * @param {string} tokenIdStr
 */
async function checkIsAssociated(tokenIdStr) {
	const { env } = createClient();
	const evmAddress = await homebrewPopulateAccountEvmAddress(env, tokenIdStr, EntityType.TOKEN);
	const result = await isTokenAssociated(evmAddress);

	if (isJsonMode()) {
		output(createResponse(true, {
			tokenId: tokenIdStr,
			evmAddress: evmAddress,
			isAssociated: result,
		}));
		return;
	}

	header('Token Association Check');
	row('Token', tokenIdStr);
	row('EVM Address', evmAddress);
	row('Is Associated', result ? 'Yes' : 'No');
	console.log('');
}

/**
 * Parse arguments and run
 */
async function main() {
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
	const command = args[0] || 'status';
	const param = args[1];

	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		showHelp();
		process.exit(0);
	}

	try {
		switch (command) {
		case 'status':
			await showStatus();
			break;
		case 'cost':
			await showCost();
			break;
		case 'tokens':
			await showTokens();
			break;
		case 'admins':
			await showAdmins();
			break;
		case 'users':
			await showUsers();
			break;
		case 'is-admin':
			if (!param) {
				error('Account ID required. Usage: info.js is-admin 0.0.12345');
				process.exit(2);
			}
			await checkIsAdmin(param);
			break;
		case 'is-user':
			if (!param) {
				error('Contract ID required. Usage: info.js is-user 0.0.12345');
				process.exit(2);
			}
			await checkIsUser(param);
			break;
		case 'is-assoc':
			if (!param) {
				error('Token ID required. Usage: info.js is-assoc 0.0.48486075');
				process.exit(2);
			}
			await checkIsAssociated(param);
			break;
		default:
			error(`Unknown command: ${command}`);
			showHelp();
			process.exit(2);
		}
		process.exit(0);
	}
	catch (err) {
		if (isJsonMode()) {
			output(createResponse(false, null, err));
		}
		else {
			error(err.message);
		}
		process.exit(1);
	}
}

main();
