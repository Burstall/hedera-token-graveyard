const { readOnlyEVMFromMirrorNode } = require('./solidityHelpers');

/**
 * Estimate gas for a contract function call using mirror node
 * @param {string} env - Environment (TEST, MAIN, PREVIEW, LOCAL)
 * @param {ContractId} contractId - Contract ID
 * @param {ethers.Interface} contractInterface - Contract ABI interface
 * @param {AccountId} operatorId - Operator account ID
 * @param {string} functionName - Function name to call
 * @param {Array} parameters - Function parameters
 * @param {number} fallbackGas - Fallback gas limit if estimation fails
 * @param {number} [value=0] - Amount of hbar to send in tinybars
 * @returns {Promise<{gasLimit: number, isEstimated: boolean, estimatedGas?: number}>}
 */
async function estimateGas(env, contractId, contractInterface, operatorId, functionName, parameters, fallbackGas, value = 0) {
	const openerString = `🔍 Estimating gas for ${functionName}...`;
	try {
		const encodedCommand = contractInterface.encodeFunctionData(functionName, parameters);

		const gasEstimate = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			true,
			fallbackGas * 2,
			value,
		);

		const estimatedGas = Number(gasEstimate);
		const multiplier = estimatedGas < 600_000 ? 1.50 : 1.20;
		const gasWithBuffer = Math.min(Math.ceil(estimatedGas * multiplier), 14_500_000);
		// Cap at 14.5 million gas

		console.log(`${openerString}\t📊 Gas Estimate: ${estimatedGas.toLocaleString()} | With ${((multiplier - 1) * 100).toFixed(0)}% buffer: ${gasWithBuffer.toLocaleString()}`);

		return {
			gasLimit: gasWithBuffer,
			isEstimated: true,
			estimatedGas: estimatedGas,
		};
	}
	catch (error) {
		console.log(`${openerString}\t⚠️  Gas estimation failed for ${functionName}:`, error.message);
		console.log(`📋 Using fallback gas limit: ${fallbackGas}`);

		return {
			gasLimit: fallbackGas,
			isEstimated: false,
		};
	}
}

/**
 * Log transaction result with gas usage comparison
 * @param {Array} result - Contract execution result [status, returnValues, receipt]
 * @param {string} operation - Operation name for logging
 * @param {object} gasInfo - Gas estimation info from estimateGas
 */
function logTransactionResult(result, operation, gasInfo) {
	const [status, , receipt] = result;

	// Handle both simple status strings and complex status objects
	const statusString = typeof status === 'object' && status.status ? status.status.toString() : status?.toString();

	if (statusString === 'SUCCESS') {
		console.log(`✅ ${operation} completed successfully!`);

		if (receipt?.transactionId) {
			console.log(`📝 Transaction ID: ${receipt.transactionId.toString()}`);
		}

		// Log gas usage comparison if available
		if (receipt?.contractFunctionResult?.gasUsed) {
			const gasUsed = Number(receipt.contractFunctionResult.gasUsed);
			const gasLimit = gasInfo.gasLimit;
			const efficiency = ((gasUsed / gasLimit) * 100).toFixed(1);

			console.log(`⛽ Gas Usage: ${gasUsed.toLocaleString()} / ${gasLimit.toLocaleString()} (${efficiency}% efficiency)`);

			if (gasInfo.estimatedGas) {
				const accuracy = ((gasUsed / gasInfo.estimatedGas) * 100).toFixed(1);
				console.log(`🎯 Estimate Accuracy: ${accuracy}% (${gasUsed.toLocaleString()} vs ${gasInfo.estimatedGas.toLocaleString()} estimated)`);
			}
		}
	}
	else {
		console.log(`❌ ${operation} failed:`, statusString?.name);

		// Log detailed failure information
		// if (typeof result === 'object') {
		// 	console.log('📋 Full status details:', JSON.stringify(result, null, 2));
		// }

		console.log(`📝 Failed Transaction ID: ${result[1].toString()}`);
	}
}

module.exports = {
	estimateGas,
	logTransactionResult,
};