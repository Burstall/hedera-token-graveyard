const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	ContractCallQuery,
	Hbar,
	ContractExecuteTransaction,
	AccountCreateTransaction,
	StatusError,
	TokenCreateTransaction,
	TokenType,
	TokenSupplyType,
	HbarUnit,
	AccountInfoQuery,
	// eslint-disable-next-line no-unused-vars
	TransactionReceipt,
	TransferTransaction,
	// eslint-disable-next-line no-unused-vars
	TokenId,
	ContractInfoQuery,
	TokenMintTransaction,
	// eslint-disable-next-line no-unused-vars
	ContractId,
	CustomRoyaltyFee,
	CustomFixedFee,
} = require('@hashgraph/sdk');
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();
const { expect } = require('chai');
const { describe, it, after } = require('mocha');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
let usagecost = Number(process.env.INITIAL_COST) || 0;
const contractName = process.env.CONTRACT_NAME ?? null;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let alicePK;
let aliceId;
let tokenId;

const client = Client.forTestnet().setOperator(operatorId, operatorKey);

describe('Deployment: ', function() {
	it('Should deploy the contract and setup conditions', async function() {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Testing:', contractName);
		// create Alice account
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(alicePK, 60);
		console.log('Alice account ID:', aliceId.toString());

		// Alice to mint a new NFT for the graveyard
		client.setOperator(aliceId, alicePK);
		await mintNFT();
		console.log('\n- NFT minted @', tokenId.toString());

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		// import ABI
		abi = json.abi;

		const contractBytecode = json.bytecode;
		const gasLimit = 800000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		await contractDeployFcn(contractBytecode, gasLimit);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;
	});
});

describe('Interaction: ', function() {
	it('Check there is a cost', async function() {
		const results = await getCostQuery();
		expect(Number(results.amt)).to.be.equal(usagecost);
	});

	it('Owner updates cost and check value', async function() {
		usagecost = Number(800000000);
		// set for owner
		client.setOperator(operatorId, operatorKey);
		const gasLim = 400000;
		const params = new ContractFunctionParameters()
			.addUint256(usagecost);
		await contractExecuteFcn(contractId, gasLim, 'updateCost', params);

		const results = await getCostQuery();
		expect(Number(results.amt)).to.be.equal(usagecost);
	});

	it('Alice unable to change cost', async function() {
		// try and set lower cost should be blocked by ownership
		const tempUsageCost = Number(100000000);
		// set for Alice
		client.setOperator(aliceId, alicePK);
		const gasLim = 400000;
		const params = new ContractFunctionParameters()
			.addUint256(tempUsageCost);
		try {
			await contractExecuteFcn(contractId, gasLim, 'updateCost', params);
		}
		catch (err) {
			expect(err instanceof StatusError).to.be.true;
			// console.log(JSON.stringify(err, null, 4));
		}

		const results = await getCostQuery();
		expect(Number(results.amt)).to.be.equal(usagecost);
	});

	it('Operator can send hbar to the contract', async function() {
		// set for Operator
		client.setOperator(operatorId, operatorKey);
		const receipt = await hbarTransferFcn(operatorId, operatorKey, contractId, 9);
		expect(receipt.status.toString() == 'SUCCESS').to.be.true;
	});

	it('Alice cannot associate a token due to no payment', async function() {
		// set for Alice
		client.setOperator(aliceId, alicePK);
		const gasLim = 800000;
		// call associate method
		const params = new ContractFunctionParameters()
			.addAddress(tokenId.toSolidityAddress());
		try {
			await contractExecuteFcn(contractId, gasLim, 'tokenAssociate', params, 0.1);
		}
		catch (err) {
			expect(err instanceof StatusError).to.be.true;
			// console.log(JSON.stringify(err, null, 4));
		}

		const [, tokenBal] = await getContractBalance(contractId);
		expect(tokenBal).to.be.equal(-1);
	});

	it('Alice can associate a token and send to the graveyard', async function() {
		// set for Alice
		client.setOperator(aliceId, alicePK);
		const gasLim = 800000;
		// call associate method
		const params = new ContractFunctionParameters()
			.addAddress(tokenId.toSolidityAddress());

		await contractExecuteFcn(contractId, gasLim, 'tokenAssociate', params, new Hbar(usagecost, HbarUnit.Tinybar));

		// check it worked
		const [, preTokenBal] = await getContractBalance(contractId);
		expect(preTokenBal == 0).to.be.true;

		// send the NFT
		await transferNFTFcn(aliceId, alicePK, contractId);

		const [, postTokenBal] = await getContractBalance(contractId);
		expect(postTokenBal == 1).to.be.true;
	});

	it('Alice unable to pull hbar from the contract', async function() {
		// set for Operator
		client.setOperator(aliceId, alicePK);

		const gasLim = 800000;
		// request 1hbar transfer out of the contract
		const params = new ContractFunctionParameters()
			.addAddress(aliceId.toSolidityAddress())
			.addUint256(100000000);
		try {
			await contractExecuteFcn(contractId, gasLim, 'transferHbar', params);
		}
		catch (err) {
			expect(err instanceof StatusError).to.be.true;
			// console.log(JSON.stringify(err, null, 4));
		}
	});

	it('Operator can pull hbar from the contract', async function() {
		const operatorBal = await getAccountBalance(operatorId);
		// set for Operator
		client.setOperator(operatorId, operatorKey);

		const [contractHbarBal] = await getContractBalance(contractId);

		const gasLim = 800000;
		// call associate method
		const params = new ContractFunctionParameters()
			.addAddress(operatorId.toSolidityAddress())
			.addUint256(contractHbarBal.toTinybars());

		await contractExecuteFcn(contractId, gasLim, 'transferHbar', params);

		const newOperatorBal = await getAccountBalance(operatorId);

		expect(newOperatorBal.toTinybars() > operatorBal.toTinybars()).to.be.true;
	});

	after('Retrieve any hbar spent', async function() {
		// get Alice balance
		const aliceHbarBal = await getAccountBalance(aliceId);
		// SDK transfer back to operator
		const receipt = await hbarTransferFcn(aliceId, alicePK, operatorId, aliceHbarBal.toBigNumber().minus(0.1));
		console.log('Clean-up -> Retrieve hbar:', receipt.status.toString());
		expect(receipt.status.toString() == 'SUCCESS').to.be.true;
	});
});

async function getCostQuery() {
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall('getCost', []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(100000)
		.execute(client);

	return await decodeFunctionResult('getCost', contractCall.bytes);
}

/**
 * Helper function to deploy the contract
 * @param {string} bytecode bytecode from compiled SOL file
 * @param {number} gasLim gas limit as a number
 */
async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters().addUint256(usagecost),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	contractId = contractCreateRx.contractId;
	contractAddress = contractId.toSolidityAddress();
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the methos call
 * @returns {[TransactionReceipt, any]} the transaction receipt and any decoded results
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults];
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}

/**
 * Helper method to encode a contract query function
 * @param {string} functionName name of the function to call
 * @param {string[]} parameters string[] of parameters - typically blank
 * @returns {Buffer} encoded function call
 */
function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

/**
 * Helper function to create new accounts
 * @param {PrivateKey} privateKey new accounts private key
 * @param {string | number} initialBalance initial balance in hbar
 * @returns {AccountId} the nrewly created Account ID object
 */
async function accountCreator(privateKey, initialBalance) {
	const response = await new AccountCreateTransaction()
		.setInitialBalance(new Hbar(initialBalance))
		.setMaxAutomaticTokenAssociations(10)
		.setKey(privateKey.publicKey)
		.execute(client);
	const receipt = await response.getReceipt(client);
	return receipt.accountId;
}

/**
 * Helper function to mint an NFT and a serial on to that token
 * Using royaltyies to test the (potentially) more complicate case
 */
async function mintNFT() {
	const supplyKey = PrivateKey.generateED25519();

	// create a basic royalty
	const fee = new CustomRoyaltyFee()
		.setNumerator(2 * 100)
		.setDenominator(10000)
		.setFeeCollectorAccountId(aliceId)
		.setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(5)));

	const tokenCreateTx = new TokenCreateTransaction()
		.setTokenType(TokenType.NonFungibleUnique)
		.setTokenName('GraveYardTest ' + aliceId.toString())
		.setTokenSymbol('GYT')
		.setInitialSupply(0)
		.setMaxSupply(1)
		.setSupplyType(TokenSupplyType.Finite)
		.setTreasuryAccountId(AccountId.fromString(aliceId))
		.setAutoRenewAccountId(AccountId.fromString(aliceId))
		.setSupplyKey(supplyKey)
		.setCustomFees([fee])
		.setMaxTransactionFee(new Hbar(50, HbarUnit.Hbar));

	tokenCreateTx.freezeWith(client);
	const signedCreateTx = await tokenCreateTx.sign(operatorKey);
	const executionResponse = await signedCreateTx.execute(client);

	/* Get the receipt of the transaction */
	const createTokenRx = await executionResponse.getReceipt(client).catch((e) => {
		console.log(e);
		console.log('Token Create **FAILED*');
		process.exit(1);
	});

	/* Get the token ID from the receipt */
	tokenId = createTokenRx.tokenId;

	const tokenMintTx = new TokenMintTransaction()
		.addMetadata(Buffer.from('ipfs://bafybeifa7yklxhptqvp6fkvsmfb4wpcq7tcz3m6y464gxjtwucdlqpqe2u/metadata.json'))
		.setTokenId(tokenId)
		.freezeWith(client);

	const signedTx = await tokenMintTx.sign(supplyKey);
	const tokenMintSubmit = await signedTx.execute(client);
	// check it worked
	const tokenMintRx = await tokenMintSubmit.getReceipt(client);
	expect(tokenMintRx.status.toString() == 'SUCCESS').to.be.true;
}

/**
 * Helper function to retrieve accoutn balance
 * @param {AccountId} acctId the account to check
 * @returns {Hbar} balance of the account as Hbar object
 */
async function getAccountBalance(acctId) {
	const query = new AccountInfoQuery().setAccountId(acctId);
	const info = await query.execute(client);
	return info.balance;
}

/**
 * Helper function to get the hbar balance of the contract and the balance of the NFT minted
 * @param {ContractId} ctrctId the contract to query
 * @returns {[Hbar, number | Long.Long]} The hbar balance of the SC
 */
async function getContractBalance(ctrctId) {

	const query = new ContractInfoQuery()
		.setContractId(ctrctId);

	const info = await query.execute(client);

	let balance;

	const tokenMap = info.tokenRelationships;
	const tokenBal = tokenMap.get(tokenId.toString());
	if (tokenBal) {
		balance = tokenBal.balance;
	}
	else {
		balance = -1;
	}

	return [info.balance, balance];
}

/**
 * Helper function to send hbar
 * @param {AccountId} sender sender address
 * @param {AccountId} receiver receiver address
 * @param {string | number | BigNumber} amount the amounbt to send
 * @returns {TransactionReceipt | null} the result
 */
async function hbarTransferFcn(sender, senderPK, receiver, amount) {
	const transferTx = new TransferTransaction()
		.addHbarTransfer(sender, -amount)
		.addHbarTransfer(receiver, amount)
		.freezeWith(client);
	const transferSign = await transferTx.sign(senderPK);
	const transferSubmit = await transferSign.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx;
}

/**
 * Helper function to send the minted NFT
 * @param {AccountId} sender the sending account
 * @param {PrivateKey} senderPK PPK from the account to sign
 * @param {AccountId} receiver the account ot receive
 * @returns {TransactionReceipt | null} the result
 */
async function transferNFTFcn(sender, senderPK, receiver) {
	const tokenTransferTx = new TransferTransaction()
		.addNftTransfer(tokenId, 1, sender, receiver)
		.setTransactionMemo('Sending to the grave...')
		.freezeWith(client);
	const signedTx = await tokenTransferTx.sign(senderPK);
	const tokenTransferSubmit = await signedTx.execute(client);
	const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);
	return tokenTransferRx;
}