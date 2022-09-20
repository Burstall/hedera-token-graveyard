const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	ContractExecuteTransaction,
	AccountInfoQuery,
	TokenId,
	ContractId,
	ContractInfoQuery,
	ReceiptStatusError,
	TransferTransaction,
	ContractCallQuery,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
// const { hethers } = require('@hashgraph/hethers');
require('dotenv').config();
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();
let abi;

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

const tokenId = TokenId.fromString(process.env.TOKEN_ID);
const contractId = ContractId.fromString(process.env.CONTRACT_ID);
const env = process.env.ENVIRONMENT ?? null;

let client;

let usagecost;

const main = async () => {
	// import ABI
	const json = JSON.parse(fs.readFileSync('./artifacts/contracts/TokenGraveyard.sol/TokenGraveyard.json', 'utf8'));
	abi = json.abi;
	console.log('\n -Loading ABI...\n');

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('deploying in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('deploying in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	let accountHbarBal = await getAccountBalance(operatorId);
	let contractHbarBal = await getContractBalance(contractId);

	console.log('Using contract: ',
		contractId.toString(),
		' / ', contractId.toSolidityAddress(),
		'balance:',
		contractHbarBal.toString());

	console.log('Using operator account: ',
		operatorId.toString(),
		' / ', operatorId.toSolidityAddress(),
		'balance:',
		accountHbarBal.toString());

	// check cost
	try {
		console.log('\ngetCost Query');
		// generate function call with function name and parameters
		const functionCallAsUint8Array = encodeFunctionCall('getCost', []);

		// query the contract
		const contractCall = await new ContractCallQuery()
			.setContractId(contractId)
			.setFunctionParameters(functionCallAsUint8Array)
			.setMaxQueryPayment(new Hbar(2))
			.setGas(100000)
			.execute(client);

		const results = decodeFunctionResult('getCost', contractCall.bytes);
		usagecost = results.amt;
		console.log(JSON.stringify(results, null, 4));
	}
	catch (err) {
		if (err instanceof ReceiptStatusError) {
			console.log(err.status, err.name, err.message);
		}
		else {
			console.log(err);
		}
	}

	// only try the association if a tokenID is specified
	if (tokenId) {

		// associate a token
		try {
			console.log('\n -Attempting to associate token');
			const gasLim = 800000;
			const params = new ContractFunctionParameters()
				.addAddress(tokenId.toSolidityAddress());
			const [associateRx, contractOutput] = await contractExecuteFcn(contractId, gasLim, 'tokenAssociate', params, new Hbar(usagecost, HbarUnit.Tinybar));
			console.log('Function results', JSON.stringify(contractOutput, 3));
			// console.log('Receipt', JSON.stringify(callHbarRx, 3));
			const associateStatus = associateRx.status;

			console.log('Association: ' + associateStatus.toString());
			accountHbarBal = await getAccountBalance(operatorId);
			contractHbarBal = await getContractBalance(contractId);
			console.log(operatorId.toString() + ' account balance ' + accountHbarBal.toString());

			console.log(contractId.toString() + ' account balance ' + contractHbarBal.toString());
		}
		catch (err) {
			console.log(err);
		}
	}

	// send hbar to contract
	try {
		console.log('\n -Attempting to send hbar to contract (Hedera JS SDK)..');
		const hbarTransferRx = await hbarTransferFcn(operatorId, contractId, 1);
		const tokenTransferStatus = hbarTransferRx.status;
		console.log('Hbar send *TO* contract status: ' + tokenTransferStatus.toString());
		accountHbarBal = await getAccountBalance(operatorId);
		contractHbarBal = await getContractBalance(contractId);
		console.log(operatorId.toString() + ' account balance ' + accountHbarBal.toString());

		console.log(contractId.toString() + ' account balance ' + contractHbarBal.toString());
	}
	catch (err) {
		console.log(err);
	}

	// move hbar from contract to operator
	try {
		console.log('\n -Attempting to retrieve hbar from contract');
		const gasLim = 400000;
		const params = new ContractFunctionParameters()
			.addAddress(operatorId.toSolidityAddress())
			.addUint256(new Hbar(1).toTinybars());
		const [callHbarRx, contractOutput] = await contractExecuteFcn(contractId, gasLim, 'transferHbar', params);
		console.log('Function results', JSON.stringify(contractOutput, 3));
		// console.log('Receipt', JSON.stringify(callHbarRx, 3));
		const callHbarStatus = callHbarRx.status;

		console.log('Move hbar *FROM* contract: ' + callHbarStatus.toString());
		accountHbarBal = await getAccountBalance(operatorId);
		contractHbarBal = await getContractBalance(contractId);
		console.log(operatorId.toString() + ' account balance ' + accountHbarBal.toString());

		console.log(contractId.toString() + ' account balance ' + contractHbarBal.toString());
	}
	catch (err) {
		console.log(err);
	}
};

async function hbarTransferFcn(sender, receiver, amount) {
	const transferTx = new TransferTransaction()
		.addHbarTransfer(sender, -amount)
		.addHbarTransfer(receiver, amount)
		.freezeWith(client);
	const transferSign = await transferTx.sign(operatorKey);
	const transferSubmit = await transferSign.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx;
}

async function getAccountBalance(acctId) {

	const query = new AccountInfoQuery()
		.setAccountId(acctId);

	const info = await query.execute(client);

	return info.balance;
}

async function getContractBalance(ctrctId) {

	const query = new ContractInfoQuery()
		.setContractId(ctrctId);

	const info = await query.execute(client);

	return info.balance;
}


function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	console.log('record bytes:', JSON.stringify(record.contractFunctionResult.bytes, 4));
	console.log('Execution return', fcnName, JSON.stringify(contractExecuteTx, 3));
	record.contractFunctionResult.logs.forEach((log) => {
		if (log.data == '0x') return;

		// convert the log.data (uint8Array) to a string
		const logStringHex = '0x'.concat(Buffer.from(log.data).toString('hex'));

		// get topics from log
		const logTopics = [];
		log.topics.forEach((topic) => {
			logTopics.push('0x'.concat(Buffer.from(topic).toString('hex')));
		});

		// decode the event data
		const event = decodeEvent('GraveyardEvent', logStringHex, logTopics.slice(1));

		if (event) {
			// output the from address stored in the event
			let outputStr = '';
			for (let f = 0; f < event.__length__; f++) {
				const field = event[f];
				let output = field.startsWith('0x') ? AccountId.fromSolidityAddress(field).toString() : field;
				output = f == 0 ? output : ' : ' + output;
				outputStr += output;
			}

			console.log(outputStr);
		}
		else {
			console.log('ERROR decoding (part of) log message');
		}

	});

	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults];
}

function decodeEvent(eventName, log, topics) {
	const eventAbi = abi.find((event) => event.name === eventName && event.type === 'event');
	try {
		const decodedLog = web3.eth.abi.decodeLog(eventAbi.inputs, log, topics);
		return decodedLog;
	}
	catch (err) {
		// console.log('ERROR decoding event', eventName, log, topics, err.message);
	}
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	console.log(
		'\n -Decoding:',
		functionName,
		'\n -outputs expected:',
		JSON.stringify(functionParameters, 3));
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
