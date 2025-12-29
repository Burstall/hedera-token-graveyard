/**
 * Multi-Signature Integration Bridge
 *
 * Adapts the multi-signature library for LazyLotto admin operations.
 * Provides drop-in replacement for contractExecuteFunction with multi-sig support.
 */

const { ContractExecuteTransaction } = require('@hashgraph/sdk');
const {
	WorkflowOrchestrator,
	EnvKeyProvider,
	PromptKeyProvider,
	EncryptedFileProvider,
} = require('@lazysuperheroes/hedera-multisig');

/**
 * Parse CLI arguments for multi-sig configuration
 *
 * @param {Array<string>} args - Process arguments (process.argv)
 * @returns {Object} Parsed multi-sig configuration
 */
function parseMultiSigArgs(args = process.argv) {
	const config = {
		enabled: false,
		workflow: 'interactive',
		threshold: null,
		keyFiles: [],
		signerLabels: [],
		exportOnly: false,
	};

	// Check for --multisig flag
	if (args.includes('--multisig')) {
		config.enabled = true;
	}

	// Check for workflow mode
	const workflowIndex = args.findIndex(arg => arg.startsWith('--workflow='));
	if (workflowIndex !== -1) {
		config.workflow = args[workflowIndex].split('=')[1];
	}

	// Check for offline flag (shorthand for --workflow=offline)
	if (args.includes('--offline')) {
		config.workflow = 'offline';
	}

	// Check for threshold
	const thresholdIndex = args.findIndex(arg => arg.startsWith('--threshold='));
	if (thresholdIndex !== -1) {
		config.threshold = parseInt(args[thresholdIndex].split('=')[1]);
	}

	// Check for key files
	const keyFileIndex = args.findIndex(arg => arg.startsWith('--keyfile='));
	if (keyFileIndex !== -1) {
		const files = args[keyFileIndex].split('=')[1].split(',');
		config.keyFiles = files.map(f => f.trim());
	}

	// Check for signer labels
	const labelIndex = args.findIndex(arg => arg.startsWith('--signers='));
	if (labelIndex !== -1) {
		const labels = args[labelIndex].split('=')[1].split(',');
		config.signerLabels = labels.map(l => l.trim());
	}

	// Check for signature files (for offline workflow execution)
	const sigIndex = args.findIndex(arg => arg.startsWith('--signatures='));
	if (sigIndex !== -1) {
		const files = args[sigIndex].split('=')[1].split(',');
		config.signatureFiles = files.map(f => f.trim());
	}

	// Check for export-only mode (offline workflow, phase 1 only)
	if (args.includes('--export-only')) {
		config.exportOnly = true;
		config.workflow = 'offline';
	}

	return config;
}

/**
 * Create key providers based on configuration
 *
 * @param {Object} config - Multi-sig configuration
 * @returns {Promise<Array>} Array of KeyProvider instances
 */
async function createKeyProviders(config) {
	const providers = [];

	if (config.keyFiles.length > 0) {
		// Use encrypted file providers
		for (const keyFile of config.keyFiles) {
			providers.push(new EncryptedFileProvider(keyFile));
		}
	}
	else if (config.workflow === 'interactive') {
		// Default to prompt-based for interactive (highest security)
		const count = config.threshold || 2;
		for (let i = 0; i < count; i++) {
			providers.push(new PromptKeyProvider());
		}
	}
	else {
		// For offline, use env provider as fallback
		providers.push(new EnvKeyProvider());
	}

	return providers;
}

/**
 * Execute a contract function with multi-signature support
 *
 * Drop-in replacement for contractExecuteFunction that adds multi-sig capabilities.
 *
 * @param {ContractId} contractId - Contract to call
 * @param {ethers.Interface} iface - Contract ABI interface
 * @param {Client} client - Hedera client
 * @param {number} gasLim - Gas limit
 * @param {string} fcnName - Function name
 * @param {Array} params - Function parameters
 * @param {number} amountHbar - HBAR to send with transaction
 * @param {boolean} flagError - Whether to log errors
 * @param {Object} multiSigConfig - Multi-sig configuration
 * @returns {Promise<Array>} [receipt, results, record] or workflow results
 */
async function contractExecuteFunctionMultiSig(
	contractId,
	iface,
	client,
	gasLim,
	fcnName,
	params = [],
	amountHbar = 0,
	flagError = false,
	multiSigConfig = null,
) {
	// Parse multi-sig config from CLI args if not provided
	if (!multiSigConfig) {
		multiSigConfig = parseMultiSigArgs();
	}

	// If multi-sig is not enabled, fall back to regular execution
	if (!multiSigConfig.enabled) {
		const { contractExecuteFunction } = require('./solidityHelpers');
		return await contractExecuteFunction(
			contractId,
			iface,
			client,
			gasLim,
			fcnName,
			params,
			amountHbar,
			flagError,
		);
	}

	// Multi-sig mode enabled
	console.log('\n🔐 Multi-Signature Mode Enabled');
	console.log(`   Workflow: ${multiSigConfig.workflow}`);
	console.log(`   Function: ${fcnName}`);
	console.log();

	// Validate gas limit
	if (!gasLim || isNaN(gasLim)) {
		gasLim = 200_000;
	}

	// Encode function call
	const encodedCommand = iface.encodeFunctionData(fcnName, params);

	// Create the transaction (but don't execute it yet)
	const transaction = new ContractExecuteTransaction()
		.setContractId(contractId)
		.setGas(gasLim)
		.setFunctionParameters(Buffer.from(encodedCommand.slice(2), 'hex'))
		.setPayableAmount(amountHbar);

	// Create workflow orchestrator
	const orchestrator = new WorkflowOrchestrator(client, {
		defaultWorkflow: multiSigConfig.workflow,
		verbose: true,
	});

	try {
		let result;

		if (multiSigConfig.workflow === 'offline') {
			// Offline workflow
			const metadata = {
				threshold: multiSigConfig.threshold || 2,
				signerLabels: multiSigConfig.signerLabels,
				contractId: contractId.toString(),
				function: fcnName,
				parameters: params,
				gasLimit: gasLim,
				hbarAmount: amountHbar,
			};

			if (multiSigConfig.exportOnly) {
				// Phase 1: Just freeze and export
				result = await orchestrator.freezeAndExport(transaction, metadata);

				if (result.success) {
					console.log('\n✅ Transaction frozen and exported successfully');
					console.log('\nNext steps:');
					console.log('1. Share transaction file with signers:');
					console.log(`   ${result.transactionFile}`);
					console.log('\n2. Signers should sign using:');
					console.log(`   node lib/multiSig/cli/sign.js ${result.transactionFile}`);
					console.log('\n3. Collect signatures and execute with:');
					console.log(`   node ${process.argv[1]} --multisig --offline --signatures=sig1.json,sig2.json`);
					console.log();
				}

				return [result, null, null];
			}
			else {
				// Full offline workflow with signature collection
				const signatureFiles = multiSigConfig.signatureFiles || [];

				if (signatureFiles.length === 0) {
					throw new Error('Offline workflow requires signature files. Use --signatures=file1.json,file2.json');
				}

				result = await orchestrator.collectAndExecute(
					transaction,
					signatureFiles,
					{ threshold: multiSigConfig.threshold || signatureFiles.length },
				);
			}
		}
		else {
			// Interactive workflow
			const keyProviders = await createKeyProviders(multiSigConfig);

			result = await orchestrator.execute(transaction, {
				workflow: 'interactive',
				keyProviders,
				threshold: multiSigConfig.threshold || keyProviders.length,
				signerLabels: multiSigConfig.signerLabels,
				metadata: {
					contractId: contractId.toString(),
					function: fcnName,
					parameters: params,
				},
			});
		}

		// Process execution result
		if (result.success && result.receipt) {
			// Decode contract results
			const receipt = result.receipt;
			const record = receipt;
			// In multi-sig, we may not have separate record

			let contractResults;
			try {
				if (record.contractFunctionResult && record.contractFunctionResult.bytes) {
					contractResults = iface.decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
				}
			}
			catch (e) {
				if (flagError) {
					console.log('Error decoding result:', e.message);
				}
			}

			return [receipt, contractResults, record];
		}
		else {
			// Handle errors
			if (flagError) {
				console.log('ERROR: Multi-sig transaction failed');
				console.log('ERROR:', result.error);
			}

			return [{ status: result.error }, null, null];
		}

	}
	catch (error) {
		if (flagError) {
			console.log('ERROR: Multi-sig execution failed');
			console.log('ERROR:', error.message);
		}

		return [{ status: error.message }, null, null];
	}
	finally {
		orchestrator.cleanup();
	}
}

/**
 * Display multi-sig usage help
 */
function displayMultiSigHelp() {
	console.log('\n' + '='.repeat(80));
	console.log('  Multi-Signature Usage Guide');
	console.log('='.repeat(80));
	console.log();
	console.log('Enable multi-sig for any admin script:');
	console.log();
	console.log('Interactive Mode (real-time signing):');
	console.log('  node scripts/interactions/LazyLotto/admin/createPool.js --multisig');
	console.log('  node scripts/interactions/LazyLotto/admin/setPlatformFee.js --multisig --threshold=2');
	console.log();
	console.log('Offline Mode (air-gapped signing):');
	console.log();
	console.log('  Step 1 - Freeze and export:');
	console.log('    node scripts/interactions/LazyLotto/admin/createPool.js --multisig --export-only');
	console.log();
	console.log('  Step 2 - Signers sign offline:');
	console.log('    node lib/multiSig/cli/sign.js <transaction-file.tx>');
	console.log();
	console.log('  Step 3 - Execute with collected signatures:');
	console.log('    node scripts/interactions/LazyLotto/admin/createPool.js --multisig --offline \\');
	console.log('      --signatures=alice.json,bob.json');
	console.log();
	console.log('Advanced Options:');
	console.log('  --workflow=interactive|offline   Choose workflow mode');
	console.log('  --threshold=N                    Require N signatures');
	console.log('  --keyfile=file1.enc,file2.enc    Use encrypted key files');
	console.log('  --signers=Alice,Bob,Charlie      Label signers for clarity');
	console.log();
	console.log('For more help: node lib/multiSig/cli/help.js');
	console.log('='.repeat(80));
	console.log();
}

/**
 * Check if multi-sig help was requested
 */
function shouldDisplayHelp(args = process.argv) {
	return args.includes('--multisig-help') || args.includes('--ms-help');
}

module.exports = {
	contractExecuteFunctionMultiSig,
	parseMultiSigArgs,
	createKeyProviders,
	displayMultiSigHelp,
	shouldDisplayHelp,
};
