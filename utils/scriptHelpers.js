/**
 * Script Helper Utilities
 *
 * Common utilities for CLI scripts including multi-sig support integration.
 */

const {
	contractExecuteFunctionMultiSig,
	parseMultiSigArgs,
	displayMultiSigHelp,
	shouldDisplayHelp,
} = require('./multiSigIntegration');

/**
 * Execute a contract function with optional multi-sig support
 *
 * This is a drop-in replacement for manual ContractExecuteTransaction that:
 * - Automatically detects --multisig flags
 * - Falls back to single-sig if multi-sig not enabled
 * - Provides consistent error handling
 *
 * @param {Object} options - Execution options
 * @param {ContractId} options.contractId - Contract to call
 * @param {ethers.Interface} options.iface - Contract ABI
 * @param {Client} options.client - Hedera client
 * @param {string} options.functionName - Function to call
 * @param {Array} options.params - Function parameters
 * @param {number} options.gas - Gas limit (default: 300000)
 * @param {number} options.payableAmount - HBAR to send (default: 0)
 * @returns {Promise<Object>} { success, receipt, results, record, error }
 */
async function executeContractFunction(options) {
	const {
		contractId,
		iface,
		client,
		functionName,
		params = [],
		gas = 300000,
		payableAmount = 0,
	} = options;

	try {
		const [receipt, results, record] =
			await contractExecuteFunctionMultiSig(
				contractId,
				iface,
				client,
				gas,
				functionName,
				params,
				payableAmount,
				true,
			);

		// Check for errors in receipt
		if (
			receipt &&
			typeof receipt.status === 'object' &&
			receipt.status.toString
		) {
			if (receipt.status.toString() !== 'SUCCESS') {
				return {
					success: false,
					error: `Transaction failed with status: ${receipt.status.toString()}`,
					receipt,
					results,
					record,
				};
			}
		}
		else if (receipt && typeof receipt.status === 'string') {
			// Error returned
			return {
				success: false,
				error: receipt.status,
				receipt,
			};
		}

		return {
			success: true,
			receipt,
			results,
			record,
		};
	}
	catch (error) {
		return {
			success: false,
			error: error.message || String(error),
		};
	}
}

/**
 * Check for multi-sig help request and display if needed
 * Call this at the start of your main() function
 *
 * @returns {boolean} True if help was displayed (script should exit)
 */
function checkMultiSigHelp() {
	if (shouldDisplayHelp()) {
		displayMultiSigHelp();
		return true;
	}
	return false;
}

/**
 * Get multi-sig configuration from CLI args
 *
 * @returns {Object} Multi-sig configuration
 */
function getMultiSigConfig() {
	return parseMultiSigArgs();
}

/**
 * Display multi-sig status banner if enabled
 *
 * @param {Object} config - Multi-sig configuration
 */
function displayMultiSigBanner(config = null) {
	if (!config) {
		config = parseMultiSigArgs();
	}

	if (config.enabled) {
		console.log('\n🔐 MULTI-SIGNATURE MODE ENABLED');
		console.log(`   Workflow: ${config.workflow.toUpperCase()}`);
		if (config.threshold) {
			console.log(
				`   Threshold: ${config.threshold} signatures required`,
			);
		}
		if (config.exportOnly) {
			console.log('   Mode: EXPORT ONLY (freeze & export transaction)');
		}
		console.log();
	}
}

module.exports = {
	executeContractFunction,
	checkMultiSigHelp,
	getMultiSigConfig,
	displayMultiSigBanner,
};
