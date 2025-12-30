const {
	AccountId,
} = require('@hashgraph/sdk');

const { ethers } = require('ethers');
const axios = require('axios');

let contractId = '';
let mirrorUrl = '';

function errorSignature(error_message) {
	const error = {
		data: '',
		signature: '',
	};

	const signature = error_message.substr(0, 8).replace('0x', '');
	error.signature = signature;
	error.data = error_message;
	return error;
}

async function getErrorFromMirror(silent, depth = 1) {
	const error = {
		data: '',
		signature: '',
	};

	// get the results from mirror
	const url = `https://${mirrorUrl}.mirrornode.hedera.com/api/v1/contracts/${contractId}/results?order=desc&limit=${depth}`;

	const response = await axios(url);
	const jsonResponse = response.data;

	if (jsonResponse.results[depth - 1].error_message) {
		const error_message = jsonResponse.results[depth - 1].error_message;
		if (error_message) {
			return errorSignature(error_message);
		}
		else {
			if (!silent) {
				console.error('no error message found');
			}
			return error;
		}
	}
	else {
		if (!silent) {
			console.error('no error message found');
		}
		return error;
	}
}

async function getAbi(signature, silent) {
	const url = `https://www.4byte.directory/api/v1/signatures/?hex_signature=${signature}`;

	const response = await axios(url);
	const jsonResponse = response.data;

	if (jsonResponse.count == 1) {
		return jsonResponse.results[0].text_signature;
	}
	else if (jsonResponse.count == 0) {
		if (!silent) {
			console.error('response from www.4byte.directory contained no data');
		}
	}
	else if (!silent) {
		console.error('response from www.4byte.directory resulted in too many results');
	}
	return '';
}

async function processError(error, silent, indent) {
	if (error.signature) {
		// get the abi for the signature
		const errorFunction = await getAbi(error.signature);
		if (errorFunction != '') {
			const abi = [];
			const abiFragment = {
				outputs: [],
				name: '',
				inputs: [],
				stateMutability: 'view',
				type: 'function',
			};
			abiFragment.name = '';

			// name and parameters are plain text such as BootstrapCallFailedError(address,bytes)
			// need to convert to an actual ABI
			const nameAndParameters = errorFunction.split('(');
			// the function's name
			abiFragment.name = nameAndParameters[0];
			const parameterList = nameAndParameters[1].replace(')', '');
			// now split the parameters into an array
			const parameters = parameterList.split(',');
			parameters.forEach(parameter => {
				const input = {
					name: '',
					internalType: '',
					type: '',
				};
				input.internalType = parameter;
				input.type = parameter;
				abiFragment.inputs.push(input);
			});

			abi.push(abiFragment);
			// Use ethers.js Interface to decode (replaces abi-decoder)
			const iface = new ethers.Interface(abi);

			try {
				const decodedData = iface.decodeFunctionData(abiFragment.name, error.data);

				console.log(`${'.'.repeat(indent)}Error is ${abiFragment.name}`);
				abiFragment.inputs.forEach((input, index) => {
					const value = decodedData[index];
					console.log(`${'.'.repeat(indent)}Parameter (${input.type}) = ${value}`);

					if (input.type == 'address') {
						console.log(`${'.'.repeat(indent)}=> Hedera address ${AccountId.fromSolidityAddress(value)}`);
					}
					console.log('');

					if ((input.type == 'bytes') && (value != null)) {
						const innerError = errorSignature(value, true);
						processError(innerError, true, indent + 2);
					}
				});
			} catch (decodeErr) {
				console.error('Failed to decode error data:', decodeErr.message);
			}
		}
	}
	else if (!silent) {
		console.error('no error signature found');
	}
}

async function main() {

	console.log('');
	console.log('════════════════════════════════════════════════════════════');
	console.log('  TokenGraveyard v2.0 - Smart Contract Error Decoder');
	console.log('════════════════════════════════════════════════════════════');
	console.log('');
	console.log('Custom errors in TokenGraveyard v2.0:');
	console.log('  - HTSAssociationFailed(int64 responseCode)');
	console.log('  - HTSTransferFailed(int64 responseCode)');
	console.log('  - TooManySerials(uint256 provided, uint256 max)');
	console.log('  - BadInput(string reason)');
	console.log('  - LastAdmin()');
	console.log('  - PermissionDenied(address user, Role required)');
	console.log('');
	console.log('Usage:');
	console.log('  node decodeSmartContractError.js <error_hex>');
	console.log('  node decodeSmartContractError.js <mirror_url> <contract_id>');
	console.log('  node decodeSmartContractError.js <mirror_url> <contract_id> <depth>');
	console.log('');

	// get the command line parameters
	const args = process.argv.slice(2);
	if (args.length == 1) {
		const error = await errorSignature(args[0]);
		await processError(error, false, 0);
	}
	else if (args.length == 2) {
		mirrorUrl = args[0];
		contractId = args[1];

		// get the signature and data for the error
		const error = await getErrorFromMirror(false);
		await processError(error, false, 0);
	}
	else if (args.length == 3) {
		mirrorUrl = args[0];
		contractId = args[1];

		// get the signature and data for the error
		const depth = args[2];
		for (let d = 1; d <= depth; d++) {
			console.log('Depth:', d);
			const error = await getErrorFromMirror(false, d);
			await processError(error, false, 0);
		}
	}
	else {
		console.log('No arguments provided. Please provide error hex or mirror details.');
	}
}

void main();
