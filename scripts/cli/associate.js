#!/usr/bin/env node
/**
 * Token Graveyard Token Association
 * Associate tokens with the graveyard contract
 *
 * Usage:
 *   node scripts/cli/associate.js <token> [options]
 *
 * Commands:
 *   <token>             Associate token (paid for regular users)
 *   free <token>        Associate token for free (admin/contract user only)
 *
 * Options:
 *   --json              Output in JSON format
 *   --confirm           Skip confirmation prompt
 *   --help, -h          Show help
 */

const readline = require('readline');
const { TokenId } = require('@hashgraph/sdk');
const { homebrewPopulateAccountEvmAddress, EntityType } = require('../../utils/hederaMirrorHelpers');
const { createClient } = require('./lib/client');
const {
	initOutputMode,
	isJsonMode,
	createResponse,
	output,
	header,
	row,
	success,
	error,
	warning,
} = require('./lib/format');
const { executeContract, GAS_LIMITS, isTokenAssociated, getCost } = require('./lib/contract');

// Initialize output mode
initOutputMode();

/**
 * Ask for confirmation
 * @param {string} message
 * @returns {Promise<boolean>}
 */
async function confirm(message) {
	if (process.argv.includes('--confirm')) {
		return true;
	}

	if (isJsonMode()) {
		error('Use --confirm flag for non-interactive mode');
		process.exit(2);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => {
		rl.question(`  ${message} (yes/no): `, answer => {
			rl.close();
			resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
		});
	});
}

/**
 * Show help
 */
function showHelp() {
	console.log(`
Token Graveyard Token Association

Usage:
  node scripts/cli/associate.js <token> [options]
  node scripts/cli/associate.js free <token> [options]

Commands:
  <token>             Associate token (paid - charges $LAZY)
  free <token>        Associate for free (admin/contract user only)

Arguments:
  token     Token ID to associate (e.g., 0.0.48486075)

Options:
  --json              Output in JSON format
  --confirm           Skip confirmation prompt
  --help, -h          Show this help

Prerequisites:
  - For paid association: $LAZY allowance to LazyGasStation
  - For free association: Must be admin or contract user

Examples:
  node scripts/cli/associate.js 0.0.48486075
  node scripts/cli/associate.js free 0.0.48486075 --confirm
  node scripts/cli/associate.js 0.0.48486075 --json --confirm
`);
}

/**
 * Associate token (paid)
 * @param {string} tokenIdStr
 */
async function associateToken(tokenIdStr) {
	const { env } = createClient();
	const tokenAddress = await homebrewPopulateAccountEvmAddress(env, tokenIdStr, EntityType.TOKEN);

	// Check if already associated
	const alreadyAssociated = await isTokenAssociated(tokenAddress);
	if (alreadyAssociated) {
		if (isJsonMode()) {
			output(createResponse(true, {
				token: tokenIdStr,
				alreadyAssociated: true,
				status: 'ALREADY_ASSOCIATED',
			}));
		} else {
			success(`Token ${tokenIdStr} is already associated`);
		}
		return;
	}

	// Get cost info
	const costData = await getCost();

	if (!isJsonMode()) {
		header('Associate Token (Paid)');
		row('Token', tokenIdStr);
		row('$LAZY Cost', costData.lazyCost);
		row('Burn %', `${costData.lazyBurnPercentage}%`);
		warning('This will charge $LAZY from your account');
		console.log('');
	}

	const confirmed = await confirm('Proceed with association?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'associateToken',
		[tokenAddress],
		GAS_LIMITS.HTS_OPERATION
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'associateToken',
			token: tokenIdStr,
			paid: true,
			lazyCost: costData.lazyCost,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Token ${tokenIdStr} associated`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Associate token (free - admin/contract user only)
 * @param {string} tokenIdStr
 */
async function associateTokenFree(tokenIdStr) {
	const { env } = createClient();
	const tokenAddress = await homebrewPopulateAccountEvmAddress(env, tokenIdStr, EntityType.TOKEN);

	// Check if already associated
	const alreadyAssociated = await isTokenAssociated(tokenAddress);
	if (alreadyAssociated) {
		if (isJsonMode()) {
			output(createResponse(true, {
				token: tokenIdStr,
				alreadyAssociated: true,
				status: 'ALREADY_ASSOCIATED',
			}));
		} else {
			success(`Token ${tokenIdStr} is already associated`);
		}
		return;
	}

	if (!isJsonMode()) {
		header('Associate Token (Free)');
		row('Token', tokenIdStr);
		row('Cost', 'Free (admin/contract user)');
		console.log('');
	}

	const confirmed = await confirm('Proceed with association?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'associateTokenFree',
		[tokenAddress],
		GAS_LIMITS.HTS_OPERATION
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'associateTokenFree',
			token: tokenIdStr,
			paid: false,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Token ${tokenIdStr} associated (free)`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Main entry point
 */
async function main() {
	const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));

	if (process.argv.includes('--help') || process.argv.includes('-h') || args.length === 0) {
		showHelp();
		process.exit(args.length === 0 ? 2 : 0);
	}

	try {
		if (args[0] === 'free') {
			if (!args[1]) {
				error('Token ID required');
				process.exit(2);
			}
			await associateTokenFree(args[1]);
		} else {
			await associateToken(args[0]);
		}
		process.exit(0);
	} catch (err) {
		if (isJsonMode()) {
			output(createResponse(false, null, err));
		} else {
			error(err.message);
		}
		process.exit(1);
	}
}

main();
