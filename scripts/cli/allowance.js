#!/usr/bin/env node
/**
 * Token Graveyard Allowance Setup
 * Set required allowances for graveyard operations
 *
 * Usage:
 *   node scripts/cli/allowance.js <command> [options]
 *
 * Commands:
 *   lazy <amount>       Set $LAZY allowance to LazyGasStation
 *   nft <token>         Set NFT allowance (all serials) to graveyard
 *
 * Options:
 *   --json              Output in JSON format
 *   --confirm           Skip confirmation prompt
 *   --help, -h          Show help
 */

const readline = require('readline');
const { TokenId, AccountAllowanceApproveTransaction } = require('@hashgraph/sdk');
const { createClient, getContractConfig } = require('./lib/client');
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
Token Graveyard Allowance Setup

Usage:
  node scripts/cli/allowance.js <command> [options]

Commands:
  lazy <amount>       Set $LAZY allowance to LazyGasStation
                      Required before paid token association
  nft <token>         Set NFT allowance (all serials) to graveyard
                      Required before staking NFTs

Arguments:
  amount    Amount of $LAZY to approve
  token     NFT token ID (e.g., 0.0.48486075)

Options:
  --json              Output in JSON format
  --confirm           Skip confirmation prompt
  --help, -h          Show this help

Why Allowances?
  - $LAZY allowance: Allows LazyGasStation to charge for token association
  - NFT allowance: Allows graveyard to transfer your NFTs via staking
    (bypasses royalties using Hedera allowance mechanism)

Examples:
  node scripts/cli/allowance.js lazy 100
  node scripts/cli/allowance.js nft 0.0.48486075 --confirm
`);
}

/**
 * Set $LAZY allowance to LazyGasStation
 * @param {string} amountStr
 */
async function setLazyAllowance(amountStr) {
	const amount = parseInt(amountStr, 10);

	if (isNaN(amount) || amount <= 0) {
		error('Amount must be a positive number');
		process.exit(2);
	}

	const { client, operatorId, operatorKey } = createClient();
	const { lazyTokenId, lazyGasStationId } = getContractConfig();

	if (!lazyTokenId || !lazyGasStationId) {
		error('LAZY_TOKEN and LAZY_GAS_STATION_CONTRACT_ID required in .env');
		process.exit(1);
	}

	if (!isJsonMode()) {
		header('Set $LAZY Allowance');
		row('$LAZY Token', lazyTokenId.toString());
		row('Spender', `LazyGasStation (${lazyGasStationId.toString()})`);
		row('Amount', amount.toString());
		console.log('');
	}

	const confirmed = await confirm('Set $LAZY allowance?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	try {
		const tx = new AccountAllowanceApproveTransaction()
			.approveTokenAllowance(lazyTokenId, operatorId, lazyGasStationId, amount)
			.freezeWith(client);

		const signedTx = await tx.sign(operatorKey);
		const result = await signedTx.execute(client);
		const receipt = await result.getReceipt(client);

		const status = receipt.status.toString();

		if (isJsonMode()) {
			output(createResponse(status === 'SUCCESS', {
				operation: 'setLazyAllowance',
				token: lazyTokenId.toString(),
				spender: lazyGasStationId.toString(),
				amount: amount,
				status: status,
			}));
		} else {
			if (status === 'SUCCESS') {
				success(`$LAZY allowance set: ${amount}`);
			} else {
				error(`Failed: ${status}`);
			}
		}
	} catch (err) {
		if (isJsonMode()) {
			output(createResponse(false, null, err));
		} else {
			error(err.message);
		}
		process.exit(1);
	}
}

/**
 * Set NFT allowance (all serials) to graveyard
 * @param {string} tokenIdStr
 */
async function setNftAllowance(tokenIdStr) {
	const tokenId = TokenId.fromString(tokenIdStr);

	const { client, operatorId, operatorKey } = createClient();
	const { graveyardId } = getContractConfig();

	if (!graveyardId) {
		error('GRAVEYARD_CONTRACT_ID required in .env');
		process.exit(1);
	}

	if (!isJsonMode()) {
		header('Set NFT Allowance');
		row('NFT Token', tokenIdStr);
		row('Spender', `TokenGraveyard (${graveyardId.toString()})`);
		row('Scope', 'All serials');
		warning('This allows the graveyard to transfer ALL serials of this NFT');
		console.log('');
	}

	const confirmed = await confirm('Set NFT allowance?');
	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		} else {
			warning('Cancelled');
		}
		return;
	}

	try {
		const tx = new AccountAllowanceApproveTransaction()
			.approveTokenNftAllowanceAllSerials(tokenId, operatorId, graveyardId)
			.freezeWith(client);

		const signedTx = await tx.sign(operatorKey);
		const result = await signedTx.execute(client);
		const receipt = await result.getReceipt(client);

		const status = receipt.status.toString();

		if (isJsonMode()) {
			output(createResponse(status === 'SUCCESS', {
				operation: 'setNftAllowance',
				token: tokenIdStr,
				spender: graveyardId.toString(),
				allSerials: true,
				status: status,
			}));
		} else {
			if (status === 'SUCCESS') {
				success(`NFT allowance set for ${tokenIdStr}`);
			} else {
				error(`Failed: ${status}`);
			}
		}
	} catch (err) {
		if (isJsonMode()) {
			output(createResponse(false, null, err));
		} else {
			error(err.message);
		}
		process.exit(1);
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
		case 'lazy':
			if (!args[1]) {
				error('Amount required');
				console.log('Usage: allowance.js lazy <amount>');
				process.exit(2);
			}
			await setLazyAllowance(args[1]);
			break;
		case 'nft':
			if (!args[1]) {
				error('Token ID required');
				console.log('Usage: allowance.js nft <token>');
				process.exit(2);
			}
			await setNftAllowance(args[1]);
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
