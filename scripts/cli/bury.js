#!/usr/bin/env node
/**
 * Token Graveyard NFT Burial Operations
 * PERMANENTLY bury NFTs in the graveyard
 *
 * Usage:
 *   node scripts/cli/bury.js <token> <serials> [options]
 *
 * The script automatically detects if the NFT has fallback royalties:
 *   - WITH fallback royalties: Uses staking method (bypasses royalties)
 *   - WITHOUT fallback royalties: Uses direct SDK transfer
 *
 * Options:
 *   --json              Output in JSON format
 *   --confirm           Skip confirmation prompt (DANGEROUS)
 *   --force-stake       Force staking method even for no-royalty NFTs
 *   --force-send        Force direct send (will fail if NFT has royalties)
 *   --help, -h          Show help
 *
 * WARNING: NFT burial is PERMANENT and IRREVERSIBLE!
 */

const readline = require('readline');
const { TokenId, TransferTransaction, AccountId } = require('@hashgraph/sdk');
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
	info,
} = require('./lib/format');
const {
	executeContract,
	GAS_LIMITS,
	getCost,
	getGraveyardId,
	getLazyGasStationAddress,
	getLazyTokenAddress,
	isTokenAssociated,
} = require('./lib/contract');
const { createClient, initErrorInterfaces } = require('./lib/client');
const {
	getNFTApprovedForAllAllowances,
	checkTokenHasFallbackRoyalty,
	getTokenDetails,
	EntityType,
	homebrewPopulateAccountNum,
	checkMirrorAllowance,
	homebrewPopulateAccountEvmAddress,
	getSerialsOwned,
} = require('../../utils/hederaMirrorHelpers');
const { setNFTAllowanceAll, setFTAllowance } = require('../../utils/hederaHelpers');

// Initialize output mode
initOutputMode();

// Initialize global error interfaces for decoding errors from all contracts
initErrorInterfaces(['TokenGraveyard', 'LazyGasStation']);

// Readline interface for interactive prompts
let rl;

function getReadline() {
	if (!rl) {
		rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
	}
	return rl;
}

function closeReadline() {
	if (rl) {
		rl.close();
		rl = null;
	}
}

const ask = (question) => new Promise(resolve => {
	getReadline().question(question, resolve);
});

/**
 * Check $LAZY allowance and offer to set it
 * @returns {Promise<boolean>} true if allowance is sufficient or was set
 */
async function checkAndSetLazyAllowance(requiredAmount) {
	const { client, operatorId, env } = createClient();

	// Get LAZY token and LazyGasStation addresses from graveyard contract state
	const lazyTokenAddress = await getLazyTokenAddress();
	const lazyGasStationAddress = await getLazyGasStationAddress();

	// Convert EVM addresses to Hedera IDs
	const lazyTokenId = await homebrewPopulateAccountNum(env, lazyTokenAddress, EntityType.TOKEN);
	const lazyGasStationId = await homebrewPopulateAccountNum(env, lazyGasStationAddress, EntityType.CONTRACT);

	if (!isJsonMode()) {
		info('Checking $LAZY allowance (from contract state):');
		row('  LazyGasStation', `${lazyGasStationId} (${lazyGasStationAddress})`);
		row('  $LAZY Token', `${lazyTokenId} (${lazyTokenAddress})`);
	}

	try {
		// Check current allowance
		const allowance = await checkMirrorAllowance(
			env,
			operatorId,
			lazyTokenId,
			lazyGasStationId,
		);
		const currentAllowance = parseInt(allowance) || 0;

		if (!isJsonMode()) {
			row('  Current Allowance', currentAllowance.toString());
			row('  Required', requiredAmount.toString());
		}

		if (currentAllowance >= requiredAmount) {
			// Sufficient allowance
			if (!isJsonMode()) {
				success('$LAZY allowance sufficient');
			}
			return true;
		}

		if (isJsonMode()) {
			// Cannot prompt in JSON mode
			return false;
		}

		const setAllowance = await ask('  Would you like to set $LAZY allowance now? (yes/no): ');
		if (setAllowance.toLowerCase() !== 'yes' && setAllowance.toLowerCase() !== 'y') {
			return false;
		}

		const amountStr = await ask(`  Enter allowance amount (minimum ${requiredAmount}): `);
		const amount = parseInt(amountStr);

		if (isNaN(amount) || amount < requiredAmount) {
			error(`Invalid amount. Must be at least ${requiredAmount}`);
			return false;
		}

		console.log('  Setting $LAZY allowance...');

		const status = await setFTAllowance(client, lazyTokenId, operatorId, lazyGasStationId, amount, 'Token burial allowance');

		if (status === 'SUCCESS') {
			success('$LAZY allowance set successfully');
			return true;
		}
		else {
			error(`Failed to set $LAZY allowance: ${status}`);
			return false;
		}
	}
	catch (err) {
		if (!isJsonMode()) {
			warning(`Could not check/set allowance: ${err.message}`);
		}
		return false;
	}
}

/**
 * Check NFT allowance for staking and offer to set it
 * @returns {Promise<boolean>} true if allowance is sufficient or was set
 */
async function checkAndSetNFTAllowance(tokenIdStr) {
	const { client, operatorId, env } = createClient();

	// Get graveyard ID from contract config
	const graveyardId = getGraveyardId().toString();

	try {
		// Check if "approve all" is set
		const approvedForAll = await getNFTApprovedForAllAllowances(env, operatorId);

		// Check if graveyard is approved for this token
		if (approvedForAll && approvedForAll.has(graveyardId)) {
			const tokens = approvedForAll.get(graveyardId);
			if (tokens.includes(tokenIdStr)) {
				return true;
			}
		}

		if (isJsonMode()) {
			return false;
		}

		console.log(`\n  NFT allowance to graveyard not set for token ${tokenIdStr}`);

		const setAllowance = await ask('\n  Would you like to set NFT allowance (all serials) now? (yes/no): ');
		if (setAllowance.toLowerCase() !== 'yes' && setAllowance.toLowerCase() !== 'y') {
			return false;
		}

		console.log('  Setting NFT allowance...');

		const status = await setNFTAllowanceAll(client, [tokenIdStr], operatorId, graveyardId, 'Sending to the graveyard');

		if (status === 'SUCCESS') {
			success('NFT allowance set successfully');
			return true;
		}
		else {
			error(`Failed to set NFT allowance: ${status}`);
			return false;
		}
	}
	catch (err) {
		if (!isJsonMode()) {
			warning(`Could not check/set NFT allowance: ${err.message}`);
		}
		return false;
	}
}

/**
 * Multi-step confirmation for dangerous operations
 */
async function confirmBurial(details) {
	if (process.argv.includes('--confirm')) {
		return true;
	}

	if (isJsonMode()) {
		error('Use --confirm flag for non-interactive mode');
		process.exit(2);
	}

	console.log('\n  ==========================================');
	console.log('  WARNING: PERMANENT OPERATION');
	console.log('  ==========================================\n');
	console.log('  This action CANNOT be undone. NFTs will be');
	console.log('  permanently locked in the graveyard forever.\n');

	console.log('  Operation Details:');
	row('Token', details.token);
	row('Name', details.tokenName || 'Unknown');
	row('Serials', details.serials.join(', '));
	row('Count', `${details.serials.length} NFTs`);
	row('Method', details.method);
	if (details.hasFallback) {
		row('Royalties', 'Has fallback fees - using staking to bypass');
	}
	console.log('');

	// First confirmation
	const confirm1 = await ask('  Do you understand this is permanent? (yes/no): ');
	if (confirm1.toLowerCase() !== 'yes' && confirm1.toLowerCase() !== 'y') {
		console.log('\n  Operation cancelled.');
		return false;
	}

	// Second confirmation - type the word
	console.log('\n  To confirm, type "BURY" (all caps): ');
	const confirm2 = await ask('  > ');

	if (confirm2 !== 'BURY') {
		console.log('\n  Confirmation failed. Operation cancelled.');
		return false;
	}

	return true;
}

/**
 * Show help
 */
function showHelp() {
	console.log(`
Token Graveyard NFT Burial - PERMANENT Storage

Usage:
  node scripts/cli/bury.js <token> <serials> [options]

The script automatically detects if the NFT has fallback royalties:
  - WITH fallback royalties: Uses staking method (bypasses royalties)
  - WITHOUT fallback royalties: Uses direct SDK transfer (cheaper)

Arguments:
  token     Token ID (e.g., 0.0.48486075)
  serials   Comma-separated serial numbers (e.g., 1,2,3)

Options:
  --json              Output in JSON format
  --confirm           Skip confirmation (DANGEROUS - for scripting)
  --force-stake       Force staking method even for no-royalty NFTs
  --force-send        Force direct send (will fail if royalties exist)
  --help, -h          Show this help

Prerequisites (handled interactively):
  - $LAZY allowance to LazyGasStation (for token association fee)
  - For staking: NFT allowance to graveyard

Examples:
  node scripts/cli/bury.js 0.0.48486075 1,2,3
  node scripts/cli/bury.js 0.0.48486075 1,2,3,4,5 --confirm --json

WARNING: NFT burial is PERMANENT and IRREVERSIBLE!
`);
}

/**
 * Parse serials string to array
 */
function parseSerials(serialsStr) {
	const serials = serialsStr.split(',').map(s => {
		const num = parseInt(s.trim(), 10);
		if (isNaN(num) || num <= 0) {
			throw new Error(`Invalid serial number: ${s}`);
		}
		return num;
	});

	if (serials.length === 0) {
		throw new Error('At least one serial number required');
	}

	return serials;
}

/**
 * Send NFTs directly via Hedera SDK (no royalties)
 */
async function sendNFTsDirect(tokenId, serials) {
	const { client, operatorId, env } = createClient();

	// Get graveyard account ID from contract config
	const graveyardAccountId = AccountId.fromString(getGraveyardId().toString());

	// Get token EVM address
	const tokenAddress = await homebrewPopulateAccountEvmAddress(env, tokenId.toString(), EntityType.TOKEN);

	// Check if token is associated
	let isAssociated = false;
	try {
		isAssociated = await isTokenAssociated(tokenAddress);
	}
	catch (err) {
		if (!isJsonMode()) {
			warning(`Could not check association: ${err.message}`);
		}
	}

	if (!isAssociated) {
		if (!isJsonMode()) {
			info('Token not yet associated - checking $LAZY allowance...');
		}

		// Check/set $LAZY allowance
		const { lazyCost } = await getCost();
		if (parseInt(lazyCost) > 0) {
			const hasAllowance = await checkAndSetLazyAllowance(parseInt(lazyCost));
			if (!hasAllowance) {
				error('$LAZY allowance required for token association');
				return { success: false, error: 'ALLOWANCE_MISSING' };
			}
		}

		if (!isJsonMode()) {
			console.log('\n  Associating token with graveyard...');
		}

		const assocResult = await executeContract(
			'associateToken',
			[tokenAddress],
			GAS_LIMITS.ASSOCIATION,
		);

		if (assocResult.status !== 'SUCCESS') {
			error(`Token association failed: ${assocResult.status}`);
			return { success: false, error: 'ASSOCIATION_FAILED' };
		}

		if (!isJsonMode()) {
			success('Token associated');
		}
	}
	else if (!isJsonMode()) {
		info('Token already associated with graveyard - no $LAZY required');
	}

	// Send NFTs directly via SDK
	if (!isJsonMode()) {
		console.log('\n  Sending NFTs via TransferTransaction...');
	}

	try {
		const transferTx = new TransferTransaction();

		for (const serial of serials) {
			transferTx.addNftTransfer(tokenId, serial, operatorId, graveyardAccountId);
		}

		const response = await transferTx.execute(client);
		const receipt = await response.getReceipt(client);
		const txStatus = receipt.status.toString();

		return {
			success: txStatus === 'SUCCESS',
			status: txStatus,
			method: 'direct_transfer',
			transactionId: response.transactionId.toString(),
		};
	}
	catch (err) {
		return {
			success: false,
			error: err.message,
			method: 'direct_transfer',
		};
	}
}

/**
 * Stake NFTs to bury (bypasses royalties)
 */
async function stakeNFTs(tokenId, serials) {
	const tokenIdStr = tokenId.toString();
	const { env } = createClient();

	// Get token EVM address
	const tokenAddress = await homebrewPopulateAccountEvmAddress(env, tokenIdStr, EntityType.TOKEN);

	if (!isJsonMode()) {
		row('Token EVM Address', tokenAddress);
	}

	// Check if token is associated FIRST
	let isAssociated = false;
	try {
		isAssociated = await isTokenAssociated(tokenAddress);
		if (!isJsonMode()) {
			row('Token Associated', isAssociated ? 'Yes' : 'No');
		}
	}
	catch (err) {
		if (!isJsonMode()) {
			warning(`Could not check association: ${err.message}`);
		}
	}

	// Check $LAZY allowance if token is not associated
	if (!isAssociated) {
		const { lazyCost } = await getCost();
		if (parseInt(lazyCost) > 0) {
			if (!isJsonMode()) {
				info('Token not yet associated - checking $LAZY allowance...');
			}
			const hasAllowance = await checkAndSetLazyAllowance(parseInt(lazyCost));
			if (!hasAllowance) {
				error('$LAZY allowance required for token association');
				return { success: false, error: 'ALLOWANCE_MISSING' };
			}
		}
	}
	else if (!isJsonMode()) {
		info('Token already associated - no $LAZY allowance required');
	}

	// Check NFT allowance LAST
	const hasNFTAllowance = await checkAndSetNFTAllowance(tokenIdStr);
	if (!hasNFTAllowance) {
		error('NFT allowance to graveyard required for staking');
		return { success: false, error: 'NFT_ALLOWANCE_MISSING' };
	}

	if (!isJsonMode()) {
		console.log('\n  Staking NFTs to graveyard (bypassing royalties)...');
	}

	// Calculate gas based on serial count
	const batchCount = Math.ceil(serials.length / 8);
	const gasLimit = GAS_LIMITS.STAKING_BURIAL * batchCount;

	const result = await executeContract(
		'stakeNFTsToTheGrave',
		[tokenAddress, serials],
		gasLimit,
	);

	return {
		success: result.status === 'SUCCESS',
		status: result.status,
		method: 'staking',
		royaltyBypassed: true,
		gasInfo: result.gasInfo,
	};
}

/**
 * Validate operator owns the NFTs they want to bury
 * @param {string} env
 * @param {string} operatorId
 * @param {string} tokenIdStr
 * @param {number[]} serials
 * @returns {Promise<{ valid: boolean, owned: number[], notOwned: number[] }>}
 */
async function validateNFTOwnership(env, operatorId, tokenIdStr, serials) {
	const ownedSerials = await getSerialsOwned(env, operatorId, tokenIdStr);

	if (ownedSerials === null) {
		// Could not check ownership - return unknown status
		return { valid: null, owned: [], notOwned: [], error: 'Could not check ownership' };
	}

	const ownedSet = new Set(ownedSerials);
	const owned = serials.filter(s => ownedSet.has(s));
	const notOwned = serials.filter(s => !ownedSet.has(s));

	return {
		valid: notOwned.length === 0,
		owned,
		notOwned,
	};
}

/**
 * Main burial function - auto-detects method based on royalties
 */
async function buryNFTs(tokenIdStr, serialsStr) {
	const tokenId = TokenId.fromString(tokenIdStr);
	const serials = parseSerials(serialsStr);
	const { env, operatorId } = createClient();

	// Get token details
	if (!isJsonMode()) {
		header('Token Graveyard - NFT Burial');
		console.log('\n  Analyzing token...');
	}

	const tokenDetails = await getTokenDetails(env, tokenIdStr);

	// Validate NFT ownership before proceeding
	if (!isJsonMode()) {
		console.log('  Validating NFT ownership...');
	}

	const ownership = await validateNFTOwnership(env, operatorId.toString(), tokenIdStr, serials);

	if (ownership.valid === null) {
		// Could not verify - warn but continue
		if (!isJsonMode()) {
			warning(`Could not verify ownership: ${ownership.error}`);
		}
	}
	else if (!ownership.valid) {
		// User doesn't own some/all of the requested serials
		if (isJsonMode()) {
			output(createResponse(false, null, {
				message: 'You do not own some of the requested NFTs',
				notOwned: ownership.notOwned,
				owned: ownership.owned,
			}));
		}
		else {
			error('You do not own all of the requested NFTs');
			row('Requested', serials.join(', '));
			row('You own', ownership.owned.length > 0 ? ownership.owned.join(', ') : 'None');
			row('Not owned', ownership.notOwned.join(', '));
			console.log('');
		}
		return;
	}
	else if (!isJsonMode()) {
		success(`Ownership verified for ${serials.length} NFTs`);
	}

	const royaltyInfo = await checkTokenHasFallbackRoyalty(env, tokenIdStr);

	const forceStake = process.argv.includes('--force-stake');
	const forceSend = process.argv.includes('--force-send');

	// Determine method
	let useStaking = royaltyInfo.hasFallback || forceStake;

	if (forceSend && royaltyInfo.hasFallback) {
		if (!isJsonMode()) {
			warning('Token has fallback royalties - direct send may fail!');
		}
		useStaking = false;
	}

	// Validate serial count
	if (!useStaking && serials.length > 10) {
		error('Maximum 10 NFTs per direct send (Hedera limit). Use staking or reduce count.');
		process.exit(2);
	}

	if (!isJsonMode()) {
		console.log('');
		row('Token', tokenIdStr);
		row('Name', tokenDetails?.name || 'Unknown');
		row('Symbol', tokenDetails?.symbol || 'Unknown');
		row('Serials', serials.join(', '));
		row('Count', `${serials.length} NFTs`);

		if (royaltyInfo.hasFallback) {
			row('Royalties', `YES - ${royaltyInfo.fallbackFees.length} fallback fee(s)`);
			royaltyInfo.fallbackFees.forEach((fee, i) => {
				const pct = ((fee.numerator / fee.denominator) * 100).toFixed(2);
				row(`  Fee ${i + 1}`, `${pct}% to ${fee.collector_account_id}`);
				row('  Fallback', `${fee.fallback_fee.amount / 100000000} HBAR`);
			});
		}
		else {
			row('Royalties', 'None detected');
		}

		row('Method', useStaking ? 'Staking (royalty bypass)' : 'Direct SDK Transfer');
	}

	// Get confirmation
	const confirmed = await confirmBurial({
		token: tokenIdStr,
		tokenName: tokenDetails?.name,
		serials: serials,
		method: useStaking ? 'Staking (royalty bypass)' : 'Direct SDK Transfer',
		hasFallback: royaltyInfo.hasFallback,
	});

	if (!confirmed) {
		if (isJsonMode()) {
			output(createResponse(false, null, { message: 'Cancelled by user' }));
		}
		return;
	}

	// Execute burial
	let result;
	if (useStaking) {
		result = await stakeNFTs(tokenId, serials, tokenDetails);
	}
	else {
		result = await sendNFTsDirect(tokenId, serials, tokenDetails);
	}

	// Output result
	if (isJsonMode()) {
		output(createResponse(result.success, {
			token: tokenIdStr,
			serials: serials,
			...result,
		}));
	}
	else {
		console.log('');
		if (result.success) {
			success(`${serials.length} NFTs permanently buried!`);
			row('Token', tokenIdStr);
			row('Serials', serials.join(', '));
			row('Method', result.method);
			if (result.transactionId) {
				row('Transaction', result.transactionId);
			}
			console.log('');
		}
		else {
			error(`Burial failed: ${result.status || result.error}`);
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

	// Support legacy commands for backwards compatibility
	if (args[0] === 'send' || args[0] === 'stake') {
		if (!isJsonMode()) {
			info(`Note: '${args[0]}' command is deprecated. Method is now auto-detected.`);
		}
		args.shift();
	}

	if (args.length < 2) {
		error('Token ID and serials required');
		console.log('Usage: bury.js <token> <serials>');
		process.exit(2);
	}

	try {
		await buryNFTs(args[0], args[1]);
		closeReadline();
		process.exit(0);
	}
	catch (err) {
		if (isJsonMode()) {
			output(createResponse(false, null, err));
		}
		else {
			error(err.message);
		}
		closeReadline();
		process.exit(1);
	}
}

main();
