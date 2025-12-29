#!/usr/bin/env node
/**
 * Token Graveyard Admin Operations
 * Administrative functions for the graveyard contract
 *
 * Usage:
 *   node scripts/cli/admin.js <command> [options]
 *
 * Commands:
 *   add-admin <account>       Add an admin
 *   remove-admin <account>    Remove an admin
 *   add-user <account>        Add a contract user
 *   remove-user <account>     Remove a contract user
 *   set-cost <cost> <burn%>   Update cost configuration
 *   withdraw-lazy <to> <amt>  Withdraw $LAZY tokens
 *   withdraw-hbar <to> <amt>  Withdraw hbar (in tinybars)
 *   drain-hbar                Withdraw ALL hbar to operator
 *   balance                   Show graveyard HBAR balance
 *
 * Options:
 *   --json              Output in JSON format
 *   --confirm           Skip confirmation prompt (for scripting)
 *   --help, -h          Show help
 */

const readline = require('readline');
const { AccountId, AccountBalanceQuery } = require('@hashgraph/sdk');
const { homebrewPopulateAccountEvmAddress, EntityType } = require('../../utils/hederaMirrorHelpers');
const { createClient, validateGraveyardConfig } = require('./lib/client');
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
const { executeContract, GAS_LIMITS, isAdmin, getGraveyardId } = require('./lib/contract');

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
Token Graveyard Admin Operations

Usage:
  node scripts/cli/admin.js <command> [options]

Commands:
  add-admin <account>        Add an admin (e.g., 0.0.12345)
  remove-admin <account>     Remove an admin
  add-user <account>         Add a contract user
  remove-user <account>      Remove a contract user
  set-cost <cost> <burn%>    Update cost (e.g., set-cost 10 25)
  withdraw-lazy <to> <amt>   Withdraw $LAZY to account
  withdraw-hbar <to> <amt>   Withdraw hbar (tinybars)
  drain-hbar                 Withdraw ALL hbar to operator
  balance                    Show graveyard HBAR balance

Options:
  --json              Output in JSON format
  --confirm           Skip confirmation prompt
  --help, -h          Show this help

Examples:
  node scripts/cli/admin.js add-admin 0.0.12345
  node scripts/cli/admin.js set-cost 10 25 --confirm
  node scripts/cli/admin.js drain-hbar --confirm
  node scripts/cli/admin.js balance --json
`);
}

/**
 * Add admin
 * @param {string} accountIdStr
 */
async function addAdmin(accountIdStr) {
	const { env } = createClient();
	const evmAddress = await homebrewPopulateAccountEvmAddress(env, accountIdStr, EntityType.ACCOUNT);

	if (!isJsonMode()) {
		header('Add Admin');
		row('Account', accountIdStr);
		console.log('');
	}

	const confirmed = await confirm('Add this account as admin?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'addAdmin',
		[evmAddress],
		GAS_LIMITS.SIMPLE_ADMIN
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'addAdmin',
			account: accountIdStr,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Admin added: ${accountIdStr}`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Remove admin
 * @param {string} accountIdStr
 */
async function removeAdmin(accountIdStr) {
	const { env } = createClient();
	const evmAddress = await homebrewPopulateAccountEvmAddress(env, accountIdStr, EntityType.ACCOUNT);

	if (!isJsonMode()) {
		header('Remove Admin');
		row('Account', accountIdStr);
		warning('This will revoke admin privileges');
		console.log('');
	}

	const confirmed = await confirm('Remove this admin?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'removeAdmin',
		[evmAddress],
		GAS_LIMITS.SIMPLE_ADMIN
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'removeAdmin',
			account: accountIdStr,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Admin removed: ${accountIdStr}`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Add contract user
 * @param {string} accountIdStr
 */
async function addUser(accountIdStr) {
	const { env } = createClient();
	const evmAddress = await homebrewPopulateAccountEvmAddress(env, accountIdStr, EntityType.CONTRACT);

	if (!isJsonMode()) {
		header('Add Contract User');
		row('Account', accountIdStr);
		console.log('');
	}

	const confirmed = await confirm('Add this account as contract user?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'addContractUser',
		[evmAddress],
		GAS_LIMITS.SIMPLE_ADMIN
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'addContractUser',
			account: accountIdStr,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Contract user added: ${accountIdStr}`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Remove contract user
 * @param {string} accountIdStr
 */
async function removeUser(accountIdStr) {
	const { env } = createClient();
	const evmAddress = await homebrewPopulateAccountEvmAddress(env, accountIdStr, EntityType.CONTRACT);

	if (!isJsonMode()) {
		header('Remove Contract User');
		row('Account', accountIdStr);
		console.log('');
	}

	const confirmed = await confirm('Remove this contract user?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'removeContractUser',
		[evmAddress],
		GAS_LIMITS.SIMPLE_ADMIN
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'removeContractUser',
			account: accountIdStr,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Contract user removed: ${accountIdStr}`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Update cost configuration
 * @param {string} costStr
 * @param {string} burnPercentStr
 */
async function setCost(costStr, burnPercentStr) {
	const cost = parseInt(costStr, 10);
	const burnPercent = parseInt(burnPercentStr, 10);

	if (isNaN(cost) || isNaN(burnPercent)) {
		error('Cost and burn percentage must be numbers');
		process.exit(2);
	}

	if (burnPercent < 0 || burnPercent > 100) {
		error('Burn percentage must be between 0 and 100');
		process.exit(2);
	}

	if (!isJsonMode()) {
		header('Update Cost Configuration');
		row('New $LAZY Cost', cost.toString());
		row('New Burn %', `${burnPercent}%`);
		row('Net to Treasury', `${100 - burnPercent}%`);
		console.log('');
	}

	const confirmed = await confirm('Update cost configuration?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'updateCost',
		[cost, burnPercent],
		GAS_LIMITS.SIMPLE_ADMIN
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'updateCost',
			lazyCost: cost,
			lazyBurnPercentage: burnPercent,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success('Cost configuration updated');
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Withdraw $LAZY
 * @param {string} receiverStr
 * @param {string} amountStr
 */
async function withdrawLazy(receiverStr, amountStr) {
	const { env } = createClient();
	const amount = parseInt(amountStr, 10);

	if (isNaN(amount) || amount <= 0) {
		error('Amount must be a positive number');
		process.exit(2);
	}

	const receiverAddress = await homebrewPopulateAccountEvmAddress(env, receiverStr, EntityType.ACCOUNT);

	if (!isJsonMode()) {
		header('Withdraw $LAZY');
		row('Receiver', receiverStr);
		row('Amount', amount.toString());
		console.log('');
	}

	const confirmed = await confirm('Withdraw $LAZY tokens?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'withdrawLazy',
		[receiverAddress, amount],
		GAS_LIMITS.TOKEN_TRANSFER
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'withdrawLazy',
			receiver: receiverStr,
			amount: amount,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Withdrew ${amount} $LAZY to ${receiverStr}`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Withdraw hbar
 * @param {string} receiverStr
 * @param {string} amountStr
 */
async function withdrawHbar(receiverStr, amountStr) {
	const { env } = createClient();
	const amount = parseInt(amountStr, 10);

	if (isNaN(amount) || amount <= 0) {
		error('Amount must be a positive number (in tinybars)');
		process.exit(2);
	}

	const receiverAddress = await homebrewPopulateAccountEvmAddress(env, receiverStr, EntityType.ACCOUNT);

	if (!isJsonMode()) {
		header('Withdraw Hbar');
		row('Receiver', receiverStr);
		row('Amount (tinybars)', amount.toString());
		console.log('');
	}

	const confirmed = await confirm('Withdraw hbar?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'withdrawHbar',
		[receiverAddress, amount],
		GAS_LIMITS.HTS_OPERATION
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'withdrawHbar',
			receiver: receiverStr,
			amountTinybars: amount,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Withdrew ${amount} tinybars to ${receiverStr}`);
		} else {
			error(`Failed: ${result.status}`);
		}
	}
}

/**
 * Show graveyard HBAR balance
 */
async function showBalance() {
	const { client, operatorId, env } = createClient();
	const graveyardId = getGraveyardId();
	const graveyardAcctId = AccountId.fromString(graveyardId.toString());

	const balance = await new AccountBalanceQuery().setAccountId(graveyardAcctId).execute(client);
	const tinybars = balance.hbars.toTinybars().toString();

	if (isJsonMode()) {
		output(createResponse(true, {
			contractId: graveyardId.toString(),
			hbar: balance.hbars.toString(),
			tinybars: tinybars,
		}));
	} else {
		header('Graveyard HBAR Balance');
		row('Contract', graveyardId.toString());
		row('Balance', balance.hbars.toString());
		row('Tinybars', tinybars);
		console.log('');
	}
}

/**
 * Drain all HBAR from graveyard to operator
 */
async function drainHbar() {
	const { client, operatorId, env } = createClient();
	const graveyardId = getGraveyardId();
	const graveyardAcctId = AccountId.fromString(graveyardId.toString());

	// Check current balance
	const balance = await new AccountBalanceQuery().setAccountId(graveyardAcctId).execute(client);
	const tinybars = balance.hbars.toTinybars().toNumber();

	if (tinybars === 0) {
		if (isJsonMode()) {
			output(createResponse(true, {
				operation: 'drainHbar',
				message: 'No HBAR to withdraw',
				tinybars: 0,
			}));
		} else {
			warning('No HBAR to withdraw');
		}
		return;
	}

	// Check if operator is admin
	const operatorAddress = await homebrewPopulateAccountEvmAddress(env, operatorId.toString(), EntityType.ACCOUNT);
	const adminCheck = await isAdmin(operatorAddress);

	if (!adminCheck) {
		error('Operator is not an admin, cannot withdraw');
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Not an admin' }));
		}
		return;
	}

	if (!isJsonMode()) {
		header('Drain HBAR');
		row('Current Balance', balance.hbars.toString());
		row('Tinybars', tinybars.toString());
		row('Receiver', operatorId.toString());
		console.log('');
	}

	const confirmed = await confirm('Withdraw all HBAR to operator?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	const result = await executeContract(
		'withdrawHbar',
		[operatorAddress, tinybars],
		GAS_LIMITS.HTS_OPERATION
	);

	if (isJsonMode()) {
		output(createResponse(result.status === 'SUCCESS', {
			operation: 'drainHbar',
			receiver: operatorId.toString(),
			amountTinybars: tinybars,
			status: result.status,
		}));
	} else {
		if (result.status === 'SUCCESS') {
			success(`Withdrew ${tinybars} tinybars (${balance.hbars.toString()}) to ${operatorId.toString()}`);
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
	const command = args[0];

	if (process.argv.includes('--help') || process.argv.includes('-h') || !command) {
		showHelp();
		process.exit(command ? 0 : 2);
	}

	try {
		switch (command) {
		case 'add-admin':
			if (!args[1]) {
				error('Account ID required');
				process.exit(2);
			}
			await addAdmin(args[1]);
			break;
		case 'remove-admin':
			if (!args[1]) {
				error('Account ID required');
				process.exit(2);
			}
			await removeAdmin(args[1]);
			break;
		case 'add-user':
			if (!args[1]) {
				error('Account ID required');
				process.exit(2);
			}
			await addUser(args[1]);
			break;
		case 'remove-user':
			if (!args[1]) {
				error('Account ID required');
				process.exit(2);
			}
			await removeUser(args[1]);
			break;
		case 'set-cost':
			if (!args[1] || !args[2]) {
				error('Cost and burn percentage required');
				process.exit(2);
			}
			await setCost(args[1], args[2]);
			break;
		case 'withdraw-lazy':
			if (!args[1] || !args[2]) {
				error('Receiver and amount required');
				process.exit(2);
			}
			await withdrawLazy(args[1], args[2]);
			break;
		case 'withdraw-hbar':
			if (!args[1] || !args[2]) {
				error('Receiver and amount required');
				process.exit(2);
			}
			await withdrawHbar(args[1], args[2]);
			break;
		case 'drain-hbar':
			await drainHbar();
			break;
		case 'balance':
			await showBalance();
			break;
		default:
			error(`Unknown command: ${command}`);
			showHelp();
			process.exit(2);
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
