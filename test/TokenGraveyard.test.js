/* eslint-disable comma-dangle */
const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	Hbar,
	TokenCreateTransaction,
	TokenType,
	TokenSupplyType,
	HbarUnit,
	TokenId,
	TokenMintTransaction,
	ContractId,
	CustomRoyaltyFee,
	CustomFixedFee,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const { expect } = require('chai');
const { describe, it, after, before } = require('mocha');

require('dotenv').config();

// Import utility helpers
const {
	contractDeployFunction,
	contractExecuteFunction,
	readOnlyEVMFromMirrorNode,
} = require('../utils/solidityHelpers');
const {
	accountCreator,
	associateTokensToAccount,
	sendFT,
	sendNFT,
	sendHbar,
	clearNFTAllowances,
	setFTAllowance,
	setNFTAllowanceAll,
} = require('../utils/hederaHelpers');
const {
	checkMirrorBalance,
	checkMirrorHbarBalance,
} = require('../utils/hederaMirrorHelpers');
const { sleep } = require('../utils/nodeHelpers');
const { estimateGas } = require('../utils/gasHelpers');

// Gas constants
const BASE_GAS = 400_000;
// Extra gas when contract associates a token
const ASSOCIATION_GAS_PER_TOKEN = 950_000;

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const env = process.env.ENVIRONMENT ?? null;
const lazyBurnPerc = process.env.LAZY_BURN_PERC || 25;
const lazyCost = Number(process.env.LAZY_GRAVEYARD_COST) || 10;

// Constants for scaffolding (when env vars not provided)
const lazyContractCreator = 'LAZYTokenCreator';
const lazyGasStationName = 'LazyGasStation';
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;

// These will be set during deployment (either from env or scaffolded)
let lazyTokenId;
let lazyGasStationId;
let lazySCT;
let lazyIface;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variables
let graveyardId;
let graveyardAddress;
let graveyardIface;
let lazyGasStationIface;
let alicePK;
let aliceId;
let bobPK;
let bobId;
let tokenWithRoyaltyId;
let tokenNoRoyaltyId;
let client;

/**
 * Helper function to call read-only contract functions via mirror node
 * Properly encodes and decodes the call using the interface
 * @param {ethers.Interface} iface - Contract interface
 * @param {ContractId} contractId - Contract ID
 * @param {string} functionName - Function to call
 * @param {Array} params - Function parameters
 * @param {AccountId} fromId - Account making the call (for context)
 * @returns {any} Decoded result
 */
async function readContract(iface, contractId, functionName, params = [], fromId = operatorId) {
	const encodedCommand = iface.encodeFunctionData(functionName, params);
	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		fromId,
		// estimate = false for actual call
		false,
	);
	const decoded = iface.decodeFunctionResult(functionName, result);
	// Return single value directly, or full result for multiple values
	return decoded.length === 1 ? decoded[0] : decoded;
}

/**
 * Helper to get gas estimate for a contract function
 * @param {ethers.Interface} iface - Contract interface
 * @param {ContractId} contractId - Contract ID
 * @param {string} functionName - Function name
 * @param {Array} params - Function parameters
 * @param {number} fallbackGas - Fallback gas if estimation fails
 * @param {number} valueTinybar - Value in tinybars (for payable functions)
 * @returns {Promise<number>} Gas limit to use
 */
async function getGasEstimate(iface, contractId, functionName, params = [], fallbackGas = BASE_GAS, valueTinybar = 0) {
	const gasInfo = await estimateGas(
		env,
		contractId,
		iface,
		operatorId,
		functionName,
		params,
		fallbackGas,
		valueTinybar
	);
	return gasInfo.gasLimit;
}

describe('Deployment: ', function () {
	it('Should deploy the contract and setup conditions', async function () {
		this.timeout(900000);
		// 15 minutes for deployment on testnet

		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);

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

		console.log('\n-Testing: TokenGraveyard');
		console.log('\n-Using Operator:', operatorId.toString());

		// ============================================
		// SCAFFOLD: LAZY Token (if not provided)
		// ============================================
		const lazyJson = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`)
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN) {
			console.log('\n-Using existing LAZY SCT:', process.env.LAZY_SCT_CONTRACT_ID);
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN);
			console.log('-Using existing LAZY Token ID:', lazyTokenId.toString());
		}
		else {
			console.log('\n- Deploying contract...', lazyContractCreator);
			const lazyContractBytecode = lazyJson.bytecode;
			[lazySCT] = await contractDeployFunction(client, lazyContractBytecode, 4_800_000);
			console.log(`LAZY Token Creator contract created with ID: ${lazySCT} / ${lazySCT.toSolidityAddress()}`);
			expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;

			// Mint the $LAZY FT
			await mintLazy(
				'Test_Lazy',
				'TLazy',
				'Test Lazy FT',
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				LAZY_DECIMAL,
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				30
			);
			console.log('$LAZY Token minted:', lazyTokenId.toString());
		}
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		// ============================================
		// SCAFFOLD: LazyGasStation (if not provided)
		// ============================================
		const lazyGasStationJson = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`)
		);
		lazyGasStationIface = new ethers.Interface(lazyGasStationJson.abi);

		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			console.log('\n-Using existing Lazy Gas Station:', process.env.LAZY_GAS_STATION_CONTRACT_ID);
			lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
		}
		else {
			console.log('\n- Deploying contract...', lazyGasStationName);
			const lazyGasStationBytecode = lazyGasStationJson.bytecode;
			const lazyGasStationParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress());

			[lazyGasStationId] = await contractDeployFunction(
				client,
				lazyGasStationBytecode,
				4_500_000,
				lazyGasStationParams
			);
			console.log(`Lazy Gas Station contract created with ID: ${lazyGasStationId} / ${lazyGasStationId.toSolidityAddress()}`);
		}
		expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be.true;

		// ============================================
		// Create test accounts: Alice and Bob
		// ============================================
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(client, alicePK, 300);
		console.log('\nAlice account ID:', aliceId.toString(), '\nkey:', alicePK.toString());

		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(client, bobPK, 100);
		console.log('Bob account ID:', bobId.toString(), '\nkey:', bobPK.toString());

		// Alice to mint NFTs for the graveyard
		client.setOperator(aliceId, alicePK);
		// NFT with royalties
		await mintNFT(true);
		console.log('\n- NFT with royalties minted @', tokenWithRoyaltyId.toString());

		// NFT without royalties
		await mintNFT(false);
		console.log('- NFT without royalties minted @', tokenNoRoyaltyId.toString());

		client.setOperator(operatorId, operatorKey);

		// ============================================
		// Deploy TokenGraveyard
		// ============================================
		const json = JSON.parse(fs.readFileSync('./artifacts/contracts/TokenGraveyard.sol/TokenGraveyard.json'));
		graveyardIface = new ethers.Interface(json.abi);

		// Set up global.errorInterfaces for comprehensive error decoding
		// Combine only error definitions from all contracts (avoid duplicate constructors/functions)
		const errorAbis = [
			...json.abi.filter(item => item.type === 'error'),
			...lazyGasStationJson.abi.filter(item => item.type === 'error'),
			...lazyJson.abi.filter(item => item.type === 'error'),
		];
		global.errorInterfaces = new ethers.Interface(errorAbis);

		const contractBytecode = json.bytecode;
		const gasLimit = 6_000_000;

		console.log('\n- Deploying contract... TokenGraveyard\n\tgas@', gasLimit);

		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress('0x0000000000000000000000000000000000000000')
			.addUint256(lazyCost)
			.addUint256(lazyBurnPerc);

		[graveyardId, graveyardAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams
		);

		console.log(`Contract created with ID: ${graveyardId} / ${graveyardAddress}`);

		expect(graveyardId.toString().match(addressRegex).length == 2).to.be.true;

		// Add graveyard as contract user to LazyGasStation
		const result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			300000,
			'addContractUser',
			[graveyardAddress]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		console.log('Graveyard added as contract user to LazyGasStation');

		await sleep(4000);

		// ============================================
		// Fund Alice and Bob with $LAZY
		// ============================================
		// Associate accounts with LAZY token (may already be associated - that's ok)
		client.setOperator(aliceId, alicePK);
		await associateTokensToAccount(client, aliceId, alicePK, [lazyTokenId]);
		client.setOperator(bobId, bobPK);
		await associateTokensToAccount(client, bobId, bobPK, [lazyTokenId]);

		client.setOperator(operatorId, operatorKey);

		// Draw LAZY from the SCT (LAZYTokenCreator holds the minted supply)
		// This works whether we deployed fresh or using existing env vars
		await sendLazy(aliceId, 1000);
		await sendLazy(bobId, 1000);
		console.log('Sent $LAZY to Alice and Bob');

		// ============================================
		// Fund LazyGasStation with $LAZY for payouts
		// ============================================
		// LazyGasStation needs LAZY tokens to pay out when users bury NFTs
		const lazyGasStationAccountId = AccountId.fromString(lazyGasStationId.toString());

		// Check if LGS needs LAZY
		const lgsLazyBal = await checkMirrorBalance(env, lazyGasStationId, lazyTokenId);
		if (!lgsLazyBal || lgsLazyBal < 500) {
			console.log('LazyGasStation needs LAZY, drawing from creator...');
			await sendLazy(lazyGasStationAccountId, 5000);
		}
		console.log('Funded LazyGasStation with $LAZY');

		// Check if LGS needs HBAR for operations
		const lgsHbarBal = await checkMirrorHbarBalance(env, lazyGasStationId);
		if (!lgsHbarBal || lgsHbarBal < 5) {
			console.log('LazyGasStation needs HBAR, sending from operator...');
			await sendHbar(client, operatorId, lazyGasStationAccountId, 5, HbarUnit.Hbar);
		}
		console.log('LazyGasStation funded with HBAR');

		await sleep(4000);
	});
});

describe('Access Control: ', function () {
	it('Check deployer is admin', async function () {
		client.setOperator(operatorId, operatorKey);
		const isAdmin = await readContract(graveyardIface, graveyardId, 'isAdmin', [operatorId.toSolidityAddress()]);
		expect(isAdmin).to.be.true;
		console.log('Operator is admin');
	});

	it('Admin can add another admin', async function () {
		client.setOperator(operatorId, operatorKey);
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			400000,
			'addAdmin',
			[bobId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const isAdmin = await readContract(graveyardIface, graveyardId, 'isAdmin', [bobId.toSolidityAddress()]);
		expect(isAdmin).to.be.true;
		console.log('Bob added as admin');
	});

	it('Admin can add contract user', async function () {
		client.setOperator(bobId, bobPK);
		const gasLimit = await getGasEstimate(graveyardIface, graveyardId, 'addContractUser', [aliceId.toSolidityAddress()], BASE_GAS);
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			gasLimit,
			'addContractUser',
			[aliceId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const isContractUser = await readContract(graveyardIface, graveyardId, 'isContractUser', [aliceId.toSolidityAddress()]);
		expect(isContractUser).to.be.true;
		console.log('Alice added as contract user');
	});

	it('Non-admin cannot add admin', async function () {
		client.setOperator(aliceId, alicePK);
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			BASE_GAS,
			'addAdmin',
			[aliceId.toSolidityAddress()]
		);
		// Expect custom error PermissionDenied or a revert
		const status = result[0]?.status;
		expect(
			status?.name === 'PermissionDenied' ||
			status?.toString().includes('REVERT') ||
			status?.toString() !== 'SUCCESS'
		).to.be.true;
		console.log('Non-admin blocked from adding admin:', status?.name || status?.toString());
	});

	it('Admin can update cost', async function () {
		client.setOperator(operatorId, operatorKey);
		const newCost = 20;
		const newBurnPerc = 30;
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			400000,
			'updateCost',
			[newCost, newBurnPerc]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const results = await readContract(graveyardIface, graveyardId, 'getCost', []);
		expect(Number(results.lazyCost)).to.be.equal(newCost);
		expect(Number(results.lazyBurnPercentage)).to.be.equal(newBurnPerc);
		console.log('Cost updated successfully');
	});

	it('Admin can remove contract user', async function () {
		// Add Bob as a contract user first, then remove him
		client.setOperator(operatorId, operatorKey);

		// First add Bob as contract user
		let result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			BASE_GAS,
			'addContractUser',
			[bobId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		// Verify Bob is a contract user
		let isContractUser = await readContract(graveyardIface, graveyardId, 'isContractUser', [bobId.toSolidityAddress()]);
		expect(isContractUser).to.be.true;

		// Now remove Bob
		result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			BASE_GAS,
			'removeContractUser',
			[bobId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		// Verify Bob is no longer a contract user
		isContractUser = await readContract(graveyardIface, graveyardId, 'isContractUser', [bobId.toSolidityAddress()]);
		expect(isContractUser).to.be.false;
		console.log('Contract user removed successfully');
	});

	it('Rejects burn percentage > 100', async function () {
		client.setOperator(operatorId, operatorKey);
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			BASE_GAS,
			'updateCost',
			// 101% should be rejected
			[10, 101]
		);
		// Expect custom error InvalidBurnPercentage
		const status = result[0]?.status;
		expect(
			status?.name === 'InvalidBurnPercentage' ||
			status?.toString().includes('REVERT') ||
			status?.toString() !== 'SUCCESS'
		).to.be.true;
		console.log('Invalid burn percentage rejected:', status?.name || status?.toString());
	});
});

describe('Token Association: ', function () {
	it('Regular user can associate token with payment', async function () {
		client.setOperator(aliceId, alicePK);

		// Set allowance for graveyard to draw $LAZY via LazyGasStation
		const lazyGasStationAccountId = AccountId.fromString(lazyGasStationId.toString());
		await setFTAllowance(client, lazyTokenId, aliceId, lazyGasStationAccountId, 20);

		// Associate token - need extra gas for token association (950_000 per token)
		const gasLimit = BASE_GAS + ASSOCIATION_GAS_PER_TOKEN;
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			gasLimit,
			'associateToken',
			[tokenNoRoyaltyId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const isAssociated = await readContract(graveyardIface, graveyardId, 'isTokenAssociated', [tokenNoRoyaltyId.toSolidityAddress()]);
		expect(isAssociated).to.be.true;
		console.log('Alice associated token with payment');
	});

	it('Contract user can associate token for free', async function () {
		client.setOperator(aliceId, alicePK);

		// Extra gas for token association
		const gasLimit = BASE_GAS + ASSOCIATION_GAS_PER_TOKEN;
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			gasLimit,
			'associateTokenFree',
			[tokenWithRoyaltyId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const isAssociated = await readContract(graveyardIface, graveyardId, 'isTokenAssociated', [tokenWithRoyaltyId.toSolidityAddress()]);
		expect(isAssociated).to.be.true;
		console.log('Alice (contract user) associated token for free');
	});

	it('Regular user cannot use free association', async function () {
		// First, remove Bob as admin so he becomes a regular user
		// (Bob was added as admin in 'Admin can add another admin' test)
		client.setOperator(operatorId, operatorKey);
		const removeResult = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			BASE_GAS,
			'removeAdmin',
			[bobId.toSolidityAddress()]
		);
		expect(removeResult[0]?.status.toString()).to.equal('SUCCESS');
		console.log('Bob removed as admin for this test');
		await sleep(2000);

		// Now Bob is a regular user (not admin, not contract user)
		client.setOperator(bobId, bobPK);
		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			BASE_GAS + ASSOCIATION_GAS_PER_TOKEN,
			'associateTokenFree',
			[tokenNoRoyaltyId.toSolidityAddress()]
		);
		// Expect PermissionDenied error
		const status = result[0]?.status;
		console.log('Status from free association attempt by Bob:', status?.name || status?.toString() || result);
		expect(
			status?.name === 'PermissionDenied' ||
			status?.toString().includes('REVERT') ||
			status?.toString() !== 'SUCCESS'
		).to.be.true;
		console.log('Regular user blocked from free association:', status?.name || status?.toString());

		// Re-add Bob as admin for subsequent tests
		client.setOperator(operatorId, operatorKey);
		const reAddResult = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			BASE_GAS,
			'addAdmin',
			[bobId.toSolidityAddress()]
		);
		expect(reAddResult[0]?.status.toString()).to.equal('SUCCESS');
		console.log('Bob re-added as admin');
	});
});

describe('Staking NFT Burial (With Royalties): ', function () {
	before(async function () {
		// The refill modifier in batchMoveNFTs should handle HBAR automatically
		// by calling lazyGasStation.refillHbar(50) when balance < 20 tinybars
		// Let's verify the setup is correct
		client.setOperator(operatorId, operatorKey);

		// Check graveyard is a contract user of LazyGasStation
		const isContractUserOfLGS = await readContract(
			lazyGasStationIface,
			lazyGasStationId,
			'isContractUser',
			[graveyardAddress]
		);
		console.log('Graveyard is contract user of LGS:', isContractUserOfLGS);

		// Check LazyGasStation HBAR balance
		const lgsHbar = await checkMirrorHbarBalance(env, lazyGasStationId);
		console.log('LazyGasStation HBAR balance:', lgsHbar);

		// Check graveyard HBAR balance (should be 0, refill will handle it)
		const graveyardHbar = await checkMirrorHbarBalance(env, graveyardId);
		console.log('Graveyard HBAR balance:', graveyardHbar);
	});

	it('Alice stakes NFTs to graveyard (bypasses royalties)', async function () {
		client.setOperator(aliceId, alicePK);

		// Set NFT allowance to graveyard (convert ContractId to AccountId)
		const serials = [1, 2, 3, 4, 5];
		const graveyardAccountId = AccountId.fromString(graveyardId.toString());
		await setNFTAllowanceAll(client, [tokenWithRoyaltyId], aliceId, graveyardAccountId);
		console.log('NFT allowance set for Alice to graveyard');

		// Set LAZY allowance to LazyGasStation for any fees
		const lazyGasStationAccountId = AccountId.fromString(lazyGasStationId.toString());
		await setFTAllowance(client, lazyTokenId, aliceId, lazyGasStationAccountId, 500);
		console.log('LAZY allowance set for Alice to LazyGasStation');

		// Debug: Check graveyard HBAR balance before staking
		const graveyardHbarNow = await checkMirrorHbarBalance(env, graveyardId);
		console.log('Graveyard HBAR balance before stake:', graveyardHbarNow);

		// Debug: Check if token is associated
		const isAssoc = await readContract(graveyardIface, graveyardId, 'isTokenAssociated', [tokenWithRoyaltyId.toSolidityAddress()]);
		console.log('Token associated with graveyard:', isAssoc);

		const preBalance = await checkMirrorBalance(env, graveyardAddress, tokenWithRoyaltyId.toString());
		console.log('Graveyard NFT balance before:', preBalance);

		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			2500000,
			'stakeNFTsToTheGrave',
			[tokenWithRoyaltyId.toSolidityAddress(), serials]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const postBalance = await checkMirrorBalance(env, graveyardAddress, tokenWithRoyaltyId.toString());
		console.log('Graveyard balance after:', postBalance);
		expect(postBalance).to.be.equal(preBalance + serials.length);
		console.log('NFTs staked to graveyard, royalties bypassed');
	});

	it('Staking handles more than 8 NFTs (batching)', async function () {
		client.setOperator(aliceId, alicePK);

		// 9 serials
		const serials = [6, 7, 8, 9, 10, 11, 12, 13, 14];
		const preBalance = await checkMirrorBalance(env, graveyardAddress, tokenWithRoyaltyId.toString());

		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			2500000,
			'stakeNFTsToTheGrave',
			[tokenWithRoyaltyId.toSolidityAddress(), serials]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const postBalance = await checkMirrorBalance(env, graveyardAddress, tokenWithRoyaltyId.toString());
		expect(postBalance).to.be.equal(preBalance + serials.length);
		console.log('Batching works: staked 9 NFTs');
	});

	it('Contract user can stake on behalf of another user', async function () {
		// Bob associates the token FIRST (before receiving NFTs)
		client.setOperator(bobId, bobPK);
		await associateTokensToAccount(client, bobId, bobPK, [tokenWithRoyaltyId]);

		// Send NFTs from Alice to Bob
		client.setOperator(aliceId, alicePK);
		const serials = [15];
		await sendNFT(client, aliceId, bobId, tokenWithRoyaltyId, serials);

		// Bob sets NFT allowance to graveyard for staking
		client.setOperator(bobId, bobPK);
		const graveyardAccountId = AccountId.fromString(graveyardId.toString());
		await setNFTAllowanceAll(client, [tokenWithRoyaltyId], bobId, graveyardAccountId);

		// Bob also needs LAZY allowance for LazyGasStation
		const lazyGasStationAccountId = AccountId.fromString(lazyGasStationId.toString());
		await setFTAllowance(client, lazyTokenId, bobId, lazyGasStationAccountId, 100);

		// Alice (contract user) stakes on behalf of Bob
		client.setOperator(aliceId, alicePK);
		const preBalance = await checkMirrorBalance(env, graveyardAddress, tokenWithRoyaltyId.toString());

		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			2500000,
			'stakeNFTsToTheGraveOnBehalf',
			[tokenWithRoyaltyId.toSolidityAddress(), serials, bobId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const postBalance = await checkMirrorBalance(env, graveyardAddress, tokenWithRoyaltyId.toString());
		expect(postBalance).to.be.equal(preBalance + serials.length);
		console.log('Contract user staked on behalf of user');
	});

	it('Rejects staking with zero serial', async function () {
		client.setOperator(aliceId, alicePK);
		// Include a zero in the serials array - should be rejected
		const serialsWithZero = [16, 0, 17];

		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			2500000,
			'stakeNFTsToTheGrave',
			[tokenWithRoyaltyId.toSolidityAddress(), serialsWithZero]
		);
		const status = result[0]?.status;
		expect(
			status?.name === 'InvalidSerialNumber' ||
			status?.toString().includes('REVERT') ||
			status?.toString() !== 'SUCCESS'
		).to.be.true;
		console.log('Zero serial correctly rejected in staking - status:', status?.name || status?.toString());
	});

	it('Rejects staking with empty serial array', async function () {
		client.setOperator(aliceId, alicePK);

		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			2500000,
			'stakeNFTsToTheGrave',
			[tokenWithRoyaltyId.toSolidityAddress(), []]
		);
		const status = result[0]?.status;
		expect(
			status?.name === 'EmptySerialsArray' ||
			status?.toString().includes('REVERT') ||
			status?.toString() !== 'SUCCESS'
		).to.be.true;
		console.log('Empty serial array correctly rejected - status:', status?.name || status?.toString());
	});
});

describe('Admin Functions: ', function () {
	it('Admin can withdraw hbar', async function () {
		client.setOperator(operatorId, operatorKey);

		// Send some hbar to contract first (10 Hbar)
		// Convert ContractId to AccountId for transfer
		const graveyardAccountId = AccountId.fromString(graveyardId.toString());
		await sendHbar(client, operatorId, graveyardAccountId, 10, HbarUnit.Hbar);
		await sleep(4000);

		const contractHbarBal = await checkMirrorHbarBalance(env, graveyardAddress);
		if (contractHbarBal > 0) {
			const operatorPreBal = await checkMirrorHbarBalance(env, operatorId.toSolidityAddress());

			const result = await contractExecuteFunction(
				graveyardId,
				graveyardIface,
				client,
				800000,
				'withdrawHbar',
				[operatorId.toSolidityAddress(), contractHbarBal]
			);
			expect(result[0]?.status.toString()).to.equal('SUCCESS');
			await sleep(4000);

			const operatorPostBal = await checkMirrorHbarBalance(env, operatorId.toSolidityAddress());
			expect(operatorPostBal).to.be.greaterThan(operatorPreBal);
			console.log('Hbar withdrawn');
		}
	});

	it('Admin can withdraw $LAZY', async function () {
		client.setOperator(operatorId, operatorKey);

		const graveyardLazyBal = await checkMirrorBalance(env, graveyardAddress, lazyTokenId.toString());
		if (graveyardLazyBal > 0) {
			const result = await contractExecuteFunction(
				graveyardId,
				graveyardIface,
				client,
				600000,
				'withdrawLazy',
				[operatorId.toSolidityAddress(), graveyardLazyBal]
			);
			expect(result[0]?.status.toString()).to.equal('SUCCESS');
			await sleep(4000);
			console.log('$LAZY withdrawn');
		}
	});

	it('Admin can remove another admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			400000,
			'removeAdmin',
			[bobId.toSolidityAddress()]
		);
		expect(result[0]?.status.toString()).to.equal('SUCCESS');
		await sleep(4000);

		const isAdmin = await readContract(
			graveyardIface,
			graveyardId,
			'isAdmin',
			[bobId.toSolidityAddress()]
		);
		expect(isAdmin).to.be.false;
		console.log('Bob removed as admin');
	});

	it('Cannot remove last admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const result = await contractExecuteFunction(
			graveyardId,
			graveyardIface,
			client,
			400000,
			'removeAdmin',
			[operatorId.toSolidityAddress()]
		);
		const status = result[0]?.status;
		expect(
			status?.name === 'LastAdmin' ||
			status?.toString().includes('REVERT') ||
			status?.toString() !== 'SUCCESS'
		).to.be.true;
		console.log('Cannot remove last admin - status:', status?.name || status?.toString());
	});
});

after('Retrieve any hbar spent', async function () {
	// Clear NFT allowances that were set during tests
	// Alice set allowance to graveyardId for tokenWithRoyaltyId
	client.setOperator(aliceId, alicePK);
	const aliceAllowances = [
		{ tokenId: tokenWithRoyaltyId, owner: aliceId, spender: graveyardId },
	];
	await clearNFTAllowances(client, aliceAllowances);

	// Bob set allowance to aliceId for tokenWithRoyaltyId
	client.setOperator(bobId, bobPK);
	const bobAllowances = [
		{ tokenId: tokenWithRoyaltyId, owner: bobId, spender: aliceId },
	];
	await clearNFTAllowances(client, bobAllowances);

	await sleep(4000);

	// Get Alice balance and transfer back to operator
	const aliceHbarBal = await checkMirrorHbarBalance(env, aliceId.toSolidityAddress());
	const aliceLazyBal = await checkMirrorBalance(env, aliceId.toSolidityAddress(), lazyTokenId.toString());

	client.setOperator(aliceId, alicePK);
	let receipt = await sendHbar(client, aliceId, operatorId, aliceHbarBal - 100000000);
	console.log('Clean-up -> Retrieve Alice hbar:', receipt);

	if (aliceLazyBal > 0) {
		receipt = await sendFT(client, lazyTokenId, aliceLazyBal, aliceId, operatorId, 'Alice $LAZY return');
		console.log('Clean-up -> Retrieve Alice $LAZY:', receipt);
	}

	// Get Bob balance and transfer back to operator
	const bobHbarBal = await checkMirrorHbarBalance(env, bobId.toSolidityAddress());
	const bobLazyBal = await checkMirrorBalance(env, bobId.toSolidityAddress(), lazyTokenId.toString());

	client.setOperator(bobId, bobPK);
	receipt = await sendHbar(client, bobId, operatorId, bobHbarBal - 100000000);
	console.log('Clean-up -> Retrieve Bob hbar:', receipt);

	if (bobLazyBal > 0) {
		receipt = await sendFT(client, lazyTokenId, bobLazyBal, bobId, operatorId, 'Bob $LAZY return');
		console.log('Clean-up -> Retrieve Bob $LAZY:', receipt);
	}
});

// ============================================
// HELPER FUNCTIONS (Local to tests)
// ============================================
async function mintNFT(withRoyalty) {
	const supplyKey = PrivateKey.generateED25519();

	const tokenCreateTx = new TokenCreateTransaction()
		.setTokenType(TokenType.NonFungibleUnique)
		.setTokenName(withRoyalty ? 'GraveYard Royalty NFT' : 'GraveYard No Royalty NFT')
		.setTokenSymbol(withRoyalty ? 'GYROY' : 'GYNOR')
		.setInitialSupply(0)
		.setMaxSupply(50)
		.setSupplyType(TokenSupplyType.Finite)
		.setTreasuryAccountId(aliceId)
		.setAutoRenewAccountId(aliceId)
		.setSupplyKey(supplyKey)
		.setMaxTransactionFee(new Hbar(75, HbarUnit.Hbar));

	if (withRoyalty) {
		const fee = new CustomRoyaltyFee()
			.setNumerator(2 * 100)
			.setDenominator(10000)
			.setFeeCollectorAccountId(aliceId)
			.setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(5)));
		tokenCreateTx.setCustomFees([fee]);
	}

	tokenCreateTx.freezeWith(client);
	const signedCreateTx = await tokenCreateTx.sign(operatorKey);
	const executionResponse = await signedCreateTx.execute(client);
	const createTokenRx = await executionResponse.getReceipt(client);

	const tokenId = createTokenRx.tokenId;

	const tokenMintTx = new TokenMintTransaction()
		.setTokenId(tokenId)
		.setMaxTransactionFee(new Hbar(50, HbarUnit.Hbar));

	// Hedera limits to 10 NFTs per mint transaction - mint first batch
	for (let i = 0; i < 10; i++) {
		tokenMintTx.addMetadata(Buffer.from('ipfs://test'));
	}

	tokenMintTx.freezeWith(client);
	const signedTx = await tokenMintTx.sign(supplyKey);
	const tokenMintSubmit = await signedTx.execute(client);
	const tokenMintRx = await tokenMintSubmit.getReceipt(client);

	if (tokenMintRx.status.toString() !== 'SUCCESS') {
		throw new Error('Token mint failed');
	}

	// Mint second batch to get more NFTs (tests need serials up to 15+)
	const tokenMintTx2 = new TokenMintTransaction()
		.setTokenId(tokenId)
		.setMaxTransactionFee(new Hbar(50, HbarUnit.Hbar));

	for (let i = 0; i < 10; i++) {
		tokenMintTx2.addMetadata(Buffer.from('ipfs://test2'));
	}

	tokenMintTx2.freezeWith(client);
	const signedTx2 = await tokenMintTx2.sign(supplyKey);
	const tokenMintSubmit2 = await signedTx2.execute(client);
	const tokenMintRx2 = await tokenMintSubmit2.getReceipt(client);

	if (tokenMintRx2.status.toString() !== 'SUCCESS') {
		throw new Error('Token mint batch 2 failed');
	}

	if (withRoyalty) {
		tokenWithRoyaltyId = tokenId;
	}
	else {
		tokenNoRoyaltyId = tokenId;
	}
}

/**
 * Mint $LAZY tokens using the LAZYTokenCreator contract
 */
async function mintLazy(
	tokenName,
	tokenSymbol,
	tokenMemo,
	tokenInitalSupply,
	decimal,
	tokenMaxSupply,
	payment
) {
	const gasLim = 800000;
	const params = [
		tokenName,
		tokenSymbol,
		tokenMemo,
		tokenInitalSupply,
		decimal,
		tokenMaxSupply,
	];

	const [, , createTokenRecord] = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		gasLim,
		'createFungibleWithBurn',
		params,
		payment
	);
	const tokenIdSolidityAddr = createTokenRecord.contractFunctionResult.getAddress(0);
	lazyTokenId = TokenId.fromSolidityAddress(tokenIdSolidityAddr);
}

/**
 * Use the LAZYTokenCreator to send $LAZY out
 * @param {AccountId} receiverId
 * @param {number} amt
 */
async function sendLazy(receiverId, amt) {
	const result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'transferHTS',
		[lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amt]
	);
	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('Failed to send $LAZY:', result);
		throw new Error('Failed to send $LAZY');
	}
	return result[0]?.status.toString();
}
