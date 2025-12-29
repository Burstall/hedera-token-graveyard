/**
 * Output Formatting Utilities
 * Supports both human-readable and JSON output modes
 */

const { AccountId, TokenId } = require('@hashgraph/sdk');

// Global output mode
let outputMode = 'human'; // 'human' | 'json' | 'quiet'

/**
 * Initialize output mode from command line arguments
 */
function initOutputMode() {
	if (process.argv.includes('--json')) {
		outputMode = 'json';
	} else if (process.argv.includes('--quiet') || process.argv.includes('-q')) {
		outputMode = 'quiet';
	}
}

/**
 * Get current output mode
 * @returns {string}
 */
function getOutputMode() {
	return outputMode;
}

/**
 * Check if running in JSON mode
 * @returns {boolean}
 */
function isJsonMode() {
	return outputMode === 'json';
}

/**
 * Create standardized response object
 * @param {boolean} success
 * @param {any} data
 * @param {Error|null} error
 * @param {object} context
 * @returns {object}
 */
function createResponse(success, data, error = null, context = {}) {
	return {
		success,
		timestamp: new Date().toISOString(),
		...context,
		data,
		error: error ? {
			code: error.code || 'UNKNOWN',
			message: error.message || String(error),
		} : null,
	};
}

/**
 * Output response in appropriate format
 * @param {object} response
 */
function output(response) {
	if (outputMode === 'json') {
		console.log(JSON.stringify(response, null, 2));
	} else if (outputMode === 'quiet') {
		if (!response.success && response.error) {
			console.error(response.error.message);
		}
	}
	// Human mode output handled by caller
}

/**
 * Print header (human mode only)
 * @param {string} text
 */
function header(text) {
	if (outputMode === 'human') {
		console.log(`\n  ${text}`);
		console.log('  ' + '='.repeat(text.length));
	}
}

/**
 * Print labeled row (human mode only)
 * @param {string} label
 * @param {string} value
 * @param {number} indent
 */
function row(label, value, indent = 2) {
	if (outputMode === 'human') {
		const padding = ' '.repeat(indent);
		const labelWidth = 25;
		const paddedLabel = label.padEnd(labelWidth);
		console.log(`${padding}${paddedLabel} ${value}`);
	}
}

/**
 * Print success message (human mode only)
 * @param {string} message
 */
function success(message) {
	if (outputMode === 'human') {
		console.log(`\n  [OK] ${message}`);
	}
}

/**
 * Print error message (human mode only)
 * @param {string} message
 */
function error(message) {
	if (outputMode === 'human') {
		console.log(`\n  [ERROR] ${message}`);
	}
}

/**
 * Print warning message (human mode only)
 * @param {string} message
 */
function warning(message) {
	if (outputMode === 'human') {
		console.log(`\n  [WARNING] ${message}`);
	}
}

/**
 * Print info message (human mode only)
 * @param {string} message
 */
function info(message) {
	if (outputMode === 'human') {
		console.log(`  ${message}`);
	}
}

/**
 * Print a table (human mode only)
 * @param {string[]} headers
 * @param {any[][]} rows
 */
function table(headers, rows) {
	if (outputMode !== 'human') return;

	// Calculate column widths
	const widths = headers.map((h, i) => {
		return Math.max(h.length, ...rows.map(r => String(r[i] || '').length)) + 2;
	});

	// Print header
	let headerLine = '  ';
	headers.forEach((h, i) => {
		headerLine += h.padEnd(widths[i]);
	});
	console.log(headerLine);
	console.log('  ' + '-'.repeat(widths.reduce((a, b) => a + b, 0)));

	// Print rows
	rows.forEach(rowData => {
		let line = '  ';
		rowData.forEach((cell, i) => {
			line += String(cell || '').padEnd(widths[i]);
		});
		console.log(line);
	});
}

/**
 * Try to convert EVM address to Hedera account ID
 * @param {string} evmAddress
 * @returns {string}
 */
function tryConvertToAccountId(evmAddress) {
	try {
		const accountId = AccountId.fromSolidityAddress(evmAddress);
		return `${accountId.toString()} (${evmAddress})`;
	} catch {
		return evmAddress;
	}
}

/**
 * Try to convert EVM address to Hedera token ID
 * @param {string} evmAddress
 * @returns {string}
 */
function tryConvertToTokenId(evmAddress) {
	try {
		const tokenId = TokenId.fromSolidityAddress(evmAddress);
		return `${tokenId.toString()} (${evmAddress})`;
	} catch {
		return evmAddress;
	}
}

/**
 * Format address list for display
 * @param {string[]} addresses
 * @param {'account'|'token'} type
 * @returns {string[]}
 */
function formatAddressList(addresses, type = 'account') {
	const converter = type === 'token' ? tryConvertToTokenId : tryConvertToAccountId;
	return addresses.map(addr => converter(addr));
}

// Error translation map for user-friendly messages
const errorTranslations = {
	'PermissionDenied': {
		message: 'Access denied - you do not have the required role',
		recovery: 'Check if your account is an admin or contract user',
	},
	'TokenNotAssociated': {
		message: 'This token is not yet associated with the graveyard',
		recovery: 'Associate the token first',
	},
	'InsufficientPayment': {
		message: 'Insufficient $LAZY allowance or balance',
		recovery: 'Set your $LAZY allowance to LazyGasStation',
	},
	'TooManySerials': {
		message: 'Too many NFT serials in one transaction',
		recovery: 'For direct send, maximum is 8 NFTs. Use staking for more.',
	},
	'HTSTransferFailed': {
		message: 'Token transfer failed',
		recovery: 'Check NFT ownership and allowances',
	},
	'LastAdmin': {
		message: 'Cannot remove the last admin',
		recovery: 'Add another admin first',
	},
	'BadInput': {
		message: 'Invalid input parameters',
		recovery: 'Check that all values are correctly formatted',
	},
};

/**
 * Translate error to user-friendly message
 * @param {Error} err
 * @returns {{ message: string, recovery: string }}
 */
function translateError(err) {
	const message = err.message || String(err);

	for (const [key, translation] of Object.entries(errorTranslations)) {
		if (message.includes(key)) {
			return translation;
		}
	}

	if (message.includes('CONTRACT_REVERT_EXECUTED')) {
		return {
			message: 'Contract execution reverted',
			recovery: 'Check permissions, token associations, and allowances',
		};
	}

	return {
		message: message,
		recovery: 'Check the error details above',
	};
}

module.exports = {
	initOutputMode,
	getOutputMode,
	isJsonMode,
	createResponse,
	output,
	header,
	row,
	success,
	error,
	warning,
	info,
	table,
	tryConvertToAccountId,
	tryConvertToTokenId,
	formatAddressList,
	translateError,
};
