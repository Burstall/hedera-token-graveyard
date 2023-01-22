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
	TokenAssociateTransaction,
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
const env = process.env.ENVIRONMENT ?? null;
const lazyContractId = ContractId.fromString(process.env.LAZY_CONTRACT);
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN);
const lazyBurnPerc = process.env.LAZY_BURN_PERC || 25;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let alicePK;
let aliceId;
let tokenId;
let client;

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

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);

		console.log('\n-Testing:', contractName);
		// create Alice account
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(alicePK, 160);
		console.log('Alice account ID:', aliceId.toString(), '\nkey:', alicePK.toString());

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
		const gasLimit = 1000000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		await contractDeployFcn(contractBytecode, gasLimit);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;
	});
});

describe('Interaction: ', function() {
	it('Check there is a cost', async function() {
		const results = await getCostQuery();
		expect(Number(results.hbarCost)).to.be.equal(usagecost);
	});

	it('Owner updates cost and check value', async function() {
		usagecost = Number(800000000);
		// set for owner
		client.setOperator(operatorId, operatorKey);
		const gasLim = 400000;
		const params = new ContractFunctionParameters()
			.addUint256(usagecost)
			.addUint256(3);
		await contractExecuteFcn(contractId, gasLim, 'updateCost', params);

		const results = await getCostQuery();
		expect(Number(results.hbarCost)).to.be.equal(usagecost);
		expect(Number(results.lazyCost)).to.be.equal(3);
	});

	it('Alice unable to change cost', async function() {
		// try and set lower cost should be blocked by ownership
		const tempUsageCost = Number(100000000);
		// set for Alice
		client.setOperator(aliceId, alicePK);
		const gasLim = 400000;
		const params = new ContractFunctionParameters()
			.addUint256(tempUsageCost)
			.addUint256(4);
		try {
			await contractExecuteFcn(contractId, gasLim, 'updateCost', params);
		}
		catch (err) {
			expect(err instanceof StatusError).to.be.true;
			// console.log(JSON.stringify(err, null, 4));
		}

		const results = await getCostQuery();
		expect(Number(results.hbarCost)).to.be.equal(usagecost);
		expect(Number(results.lazyCost)).to.be.equal(3);
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
		await transferNFTFcn(aliceId, alicePK, contractId, [1]);

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

	it('Operator can recieve an NFT with royalties and send to graveyard', async function() {
		// set for Operator
		client.setOperator(operatorId, operatorKey);
		await associateTokenToAccount(operatorId, tokenId);

		// send 3 NFTs to the operator
		const serials = [2, 3, 4];
		await transferNFTFcn(aliceId, alicePK, operatorId, serials);

		// ** TODO: when cyrptoTransfer is fixed migrate to using hbar not an FT to avoid royalties issue.
		client.setOperator(aliceId, alicePK);
		await associateTokenToAccount(aliceId, lazyTokenId);
		client.setOperator(operatorId, operatorKey);

		// now stake the 3 NFTs to the contract
		const result = await sendNFTsToTheGraveByStaking(serials);
		expect(result == 'SUCCESS').to.be.true;

		const [, tokenBal] = await getContractBalance(contractId);
		expect(tokenBal == 4).to.be.true;
	});

	it('Alice sends to graveyard via staking', async function() {
		// set for Operator
		client.setOperator(aliceId, alicePK);

		// send 3 NFTs to the operator
		const serials = [5];

		// now stake the the NFTs to the contract
		let errorCount = 0;
		try {
			// expect failure as Alic is not $LAZY
			await sendNFTsToTheGraveByStaking(serials);
		}
		catch (err) {
			errorCount++;
		}

		// associate and send $LAZY to Alice
		// await associateTokenToAccount(aliceId, lazyTokenId);
		let result = await ftTansferFcn(operatorId, aliceId, 10, lazyTokenId);
		expect(result).to.be.equal('SUCCESS');
		result = await sendNFTsToTheGraveByStaking(serials);
		expect(result == 'SUCCESS').to.be.true;

		const [, tokenBal] = await getContractBalance(contractId);
		expect(tokenBal == 5).to.be.true;
		expect(errorCount == 1).to.be.true;
	});

	it('Operator can pull hbar / $LAZY from the contract', async function() {
		const [operatorBal] = await getAccountBalance(operatorId);
		// set for Operator
		client.setOperator(operatorId, operatorKey);

		const [contractHbarBal, , lazyBalance] = await getContractBalance(contractId);

		const gasLim = 800000;
		// call associate method
		const params = new ContractFunctionParameters()
			.addAddress(operatorId.toSolidityAddress())
			.addUint256(contractHbarBal.toTinybars());

		await contractExecuteFcn(contractId, gasLim, 'transferHbar', params);

		const [newOperatorBal] = await getAccountBalance(operatorId);

		expect(newOperatorBal.toTinybars() > operatorBal.toTinybars()).to.be.true;

		// transfer the Lazy out of the contract
		if (lazyBalance > 0) {
			const pullLazy = await retrieveLazyFromContract(operatorId, lazyBalance);
			expect(pullLazy).to.be.equal('SUCCESS');
		}

	});

	after('Retrieve any hbar spent', async function() {
		// get Alice balance
		const [aliceHbarBal, , lazyBal] = await getAccountBalance(aliceId);
		// SDK transfer back to operator
		let receipt = await hbarTransferFcn(aliceId, alicePK, operatorId, aliceHbarBal.toBigNumber().minus(0.1));
		console.log('Clean-up -> Retrieve hbar:', receipt.status.toString());
		expect(receipt.status.toString() == 'SUCCESS').to.be.true;
		client.setOperator(aliceId, alicePK);
		receipt = await ftTansferFcn(aliceId, operatorId, lazyBal, lazyTokenId);
		console.log('Clean-up -> Retrieve $LAZY:', receipt);
		expect(receipt == 'SUCCESS').to.be.true;
	});
});

/**
 * Helper function for FT transfer
 * @param {AccountId} sender
 * @param {AccountId} receiver
 * @param {Number} amount
 * @param {TokenId} token
 * @returns {TransactionReceipt | any}
 */
async function ftTansferFcn(sender, receiver, amount, token) {
	const transferTx = new TransferTransaction()
		.addTokenTransfer(token, sender, -amount)
		.addTokenTransfer(token, receiver, amount)
		.freezeWith(client);
	const transferSign = await transferTx.sign(operatorKey);
	const transferSubmit = await transferSign.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx.status.toString();
}

/**
 * Method to encapsulate the staking method to send to graveyard
 * @param {Number[]} serials the list of serials ot stake
 * @returns {string} 'SUCCESS' if it worked
 */
async function sendNFTsToTheGraveByStaking(serials) {
	const params = new ContractFunctionParameters()
		.addAddress(tokenId.toSolidityAddress())
		.addUint256Array(serials);
	const [stakingRx, , ] = await contractExecuteFcn(contractId, 1000000, 'sendNFTsToTheGrave', params, new Hbar(usagecost, HbarUnit.Tinybar));
	return stakingRx.status.toString();
}

/**
 * Helper method to transfer FT using HTS
 * @param {AccountId} receiver
 * @param {number} amount amount of the FT to transfer (adjusted for decimal)
 * @returns {any} expected to be a string 'SUCCESS' implies it worked
 */
async function retrieveLazyFromContract(receiver, amount) {

	const gasLim = 600000;
	const params = new ContractFunctionParameters()
		.addAddress(receiver.toSolidityAddress())
		.addInt64(amount);
	const [tokenTransferRx, , ] = await contractExecuteFcn(contractId, gasLim, 'retrieveLazy', params);
	const tokenTransferStatus = tokenTransferRx.status;

	return tokenTransferStatus.toString();
}

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
			new ContractFunctionParameters()
				.addUint256(usagecost)
				.addAddress(lazyContractId.toSolidityAddress())
				.addAddress(lazyTokenId.toSolidityAddress())
				.addUint256(2)
				.addUint256(lazyBurnPerc),
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
		// .setMaxAutomaticTokenAssociations(5)
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
	console.log('Token Supply Key: ', supplyKey.toString());

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
		.setMaxSupply(50)
		.setSupplyType(TokenSupplyType.Finite)
		.setTreasuryAccountId(AccountId.fromString(aliceId))
		.setAutoRenewAccountId(AccountId.fromString(aliceId))
		.setSupplyKey(supplyKey)
		.setCustomFees([fee])
		.setMaxTransactionFee(new Hbar(75, HbarUnit.Hbar));

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
		.setTokenId(tokenId);

	// mint 10 tokens
	for (let i = 0; i < 10; i++) {
		tokenMintTx.addMetadata(Buffer.from('ipfs://bafybeifa7yklxhptqvp6fkvsmfb4wpcq7tcz3m6y464gxjtwucdlqpqe2u/metadata.json'));
	}

	tokenMintTx.freezeWith(client);

	const signedTx = await tokenMintTx.sign(supplyKey);
	const tokenMintSubmit = await signedTx.execute(client);
	// check it worked
	const tokenMintRx = await tokenMintSubmit.getReceipt(client);
	expect(tokenMintRx.status.toString() == 'SUCCESS').to.be.true;
}

/**
 * Helper method for token association
 * @param {AccountId} account
 * @param {TokenId} tokenToAssociate
 * @returns {any} expected to be a string 'SUCCESS' implies it worked
 */
// eslint-disable-next-line no-unused-vars
async function associateTokenToAccount(account, tokenToAssociate) {
	// now associate the token to the operator account
	const associateToken = await new TokenAssociateTransaction()
		.setAccountId(account)
		.setTokenIds([tokenToAssociate])
		.freezeWith(client);

	const associateTokenTx = await associateToken.execute(client);
	const associateTokenRx = await associateTokenTx.getReceipt(client);

	const associateTokenStatus = associateTokenRx.status;

	return associateTokenStatus.toString();
}

/**
 * Helper function to retrieve accoutn balance
 * @param {AccountId} acctId the account to check
 * @returns {Hbar} balance of the account as Hbar object
 */
async function getAccountBalance(acctId) {
	const query = new AccountInfoQuery().setAccountId(acctId);
	const info = await query.execute(client);

	let balance, lazyBalance;

	const tokenMap = info.tokenRelationships;
	const tokenBal = tokenMap.get(tokenId.toString());
	if (tokenBal) {
		balance = tokenBal.balance;
	}
	else {
		balance = -1;
	}

	const lazyBal = tokenMap.get(lazyTokenId.toString());
	if (lazyBal) {
		lazyBalance = lazyBal.balance;
	}
	else {
		lazyBalance = -1;
	}

	return [info.balance, balance, lazyBalance];
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

	let balance, lazyBalance;

	const tokenMap = info.tokenRelationships;
	const tokenBal = tokenMap.get(tokenId.toString());
	if (tokenBal) {
		balance = tokenBal.balance;
	}
	else {
		balance = -1;
	}

	const lazyBal = tokenMap.get(lazyTokenId.toString());
	if (lazyBal) {
		lazyBalance = lazyBal.balance;
	}
	else {
		lazyBalance = -1;
	}

	return [info.balance, balance, lazyBalance];
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
async function transferNFTFcn(sender, senderPK, receiver, serials) {
	const tokenTransferTx = new TransferTransaction();

	// works for up to 10 serials
	for (let i = 0; i < serials.length; i++) {
		tokenTransferTx.addNftTransfer(tokenId, serials[i], sender, receiver);
	}

	tokenTransferTx.setTransactionMemo('Sending to the grave...')
		.freezeWith(client);
	const signedTx = await tokenTransferTx.sign(senderPK);
	const tokenTransferSubmit = await signedTx.execute(client);
	const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);
	return tokenTransferRx;
}