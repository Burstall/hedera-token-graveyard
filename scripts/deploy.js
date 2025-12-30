const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	TokenId,
	ContractId,
	TransferTransaction,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readline = require('readline');
const { ethers } = require('ethers');
const { getTokenDetails, homebrewPopulateAccountEvmAddress, EntityType, checkMirrorHbarBalance } = require('../utils/hederaMirrorHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../utils/solidityHelpers');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const env = process.env.ENVIRONMENT ?? null;

// Contract configuration
const lazyContractId = process.env.LAZY_SCT_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID) : null;
const lazyTokenId = process.env.LAZY_TOKEN ? TokenId.fromString(process.env.LAZY_TOKEN) : null;
const lazyGasStationId = process.env.LAZY_GAS_STATION_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID) : null;
const lazyDelegateRegistryId = process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) : null;

const lazyBurnPerc = Number(process.env.INITIAL_LAZY_BURN_PERCENTAGE) || 25;
const lazyCost = Number(process.env.LAZY_GRAVEYARD_COST) || 10;

let client;

// Create readline interface for user input
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function ask(question) {
	return new Promise((resolve) => {
		rl.question(question, resolve);
	});
}

async function contractDeployFcn(bytecode, gasLim, params) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(params);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	const contractId = contractCreateRx.contractId;
	// Get EVM address from mirror node for consistency
	const contractAddress = await homebrewPopulateAccountEvmAddress(env, contractId.toString(), EntityType.CONTRACT);
	return [contractId, contractAddress];
}

const main = async () => {
	console.log('\n╔═══════════════════════════════════════════════════════════╗');
	console.log('║       Token Graveyard v2.1 - Deployment Script           ║');
	console.log('╚═══════════════════════════════════════════════════════════╝\n');

	console.log('Using ENVIRONMENT:', env);
	console.log('Using Operator:', operatorId.toString());

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('Deploying in *TESTNET*\n');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('Deploying in *MAINNET*\n');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		rl.close();
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// Verify prerequisites
	console.log('Checking prerequisites...');
	if (!lazyTokenId || !lazyContractId) {
		console.log('❌ ERROR: LAZY_TOKEN and LAZY_SCT_CONTRACT_ID must be set in .env file');
		rl.close();
		return;
	}
	console.log('✅ LAZY Token:', lazyTokenId.toString());
	console.log('✅ LAZY Contract:', lazyContractId.toString());

	if (!lazyGasStationId) {
		console.log('❌ ERROR: LAZY_GAS_STATION_CONTRACT_ID must be set in .env file');
		rl.close();
		return;
	}
	console.log('✅ LazyGasStation:', lazyGasStationId.toString());

	// LazyDelegateRegistry is optional
	const ldrAddress = lazyDelegateRegistryId
		? await homebrewPopulateAccountEvmAddress(env, lazyDelegateRegistryId.toString(), EntityType.ACCOUNT)
		: '0x0000000000000000000000000000000000000000';

	if (lazyDelegateRegistryId) {
		console.log('✅ LazyDelegateRegistry:', lazyDelegateRegistryId.toString());
	}
	else {
		console.log('ℹ️  LazyDelegateRegistry: Not configured (using address(0))');
	}

	// get the LAZY details from the mirror node
	const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);

	// Display configuration
	console.log('\n📋 Deployment Configuration:');
	console.log('   - $LAZY Cost:', lazyCost, '(before decimals)');
	console.log('   - $LAZY Burn %:', lazyBurnPerc);
	console.log('   - $LAZY Decimals:', lazyTokenInfo.decimals);
	console.log('   - Actual Cost:', lazyCost * (10 ** lazyTokenInfo.decimals), '(in min denom) $LAZY\n');

	const answer = await ask('Continue with deployment? (yes/no): ');
	if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
		console.log('Deployment cancelled.');
		rl.close();
		return;
	}

	// Deploy TokenGraveyard
	const contractName = 'TokenGraveyard';
	console.log('\n📦 Deploying contract...', contractName);

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));
	const contractBytecode = json.bytecode;
	const gasLimit = 4_500_000;

	// Constructor params: _lazyToken, _lazyGasStation, _lazyDelegateRegistry, lazyCost, lazyBurnPercentage
	const lazyGasStationAddress = await homebrewPopulateAccountEvmAddress(env, lazyGasStationId.toString(), EntityType.CONTRACT);
	console.log('   LazyGasStation EVM:', lazyGasStationAddress);

	const constructorParams = new ContractFunctionParameters()
		.addAddress(await homebrewPopulateAccountEvmAddress(env, lazyTokenId.toString(), EntityType.TOKEN))
		.addAddress(lazyGasStationAddress)
		.addAddress(ldrAddress)
		.addUint256(lazyCost * (10 ** lazyTokenInfo.decimals))
		.addUint256(lazyBurnPerc);

	console.log('   Gas Limit:', gasLimit);

	const [contractId, contractAddress] = await contractDeployFcn(contractBytecode, gasLimit, constructorParams);

	console.log('\n✅ Contract deployed successfully!');
	console.log('   Contract ID:', contractId.toString());
	console.log('   Contract Address:', contractAddress);

	// ═══════════════════════════════════════════════════════════════
	// Post-Deployment Setup
	// ═══════════════════════════════════════════════════════════════

	console.log('\n🔧 Running Post-Deployment Setup...\n');

	// Load LazyGasStation ABI for addContractUser call
	const lgsJson = JSON.parse(fs.readFileSync('./artifacts/contracts/LazyGasStation.sol/LazyGasStation.json'));
	const lgsIface = new ethers.Interface(lgsJson.abi);

	// Load TokenGraveyard ABI for verification
	const graveyardIface = new ethers.Interface(json.abi);

	// Helper for read-only calls using mirror node
	async function readContract(iface, cId, functionName, params = []) {
		const encodedData = iface.encodeFunctionData(functionName, params);
		const result = await readOnlyEVMFromMirrorNode(env, cId, encodedData, operatorId, false);
		const decoded = iface.decodeFunctionResult(functionName, result);
		return decoded.length === 1 ? decoded[0] : decoded;
	}

	// Step 1: Add graveyard as contract user to LazyGasStation
	console.log('1️⃣  Adding graveyard as contract user to LazyGasStation...');
	try {
		const result = await contractExecuteFunction(
			lazyGasStationId,
			lgsIface,
			client,
			400_000,
			'addContractUser',
			[contractAddress],
		);

		if (result[0]?.status?.toString() === 'SUCCESS') {
			console.log('   ✅ Graveyard registered as contract user of LazyGasStation');
		}
		else {
			console.log('   ⚠️  Registration returned:', result[0]?.status?.toString() || result[0]);
		}
	}
	catch (err) {
		console.log('   ❌ Failed to add contract user:', err.message);
		console.log('   You may need to manually call: lazyGasStation.addContractUser("' + contractAddress + '")');
	}

	// Step 2: Fund LazyGasStation with HBAR for refill mechanism
	console.log('\n2️⃣  Checking LazyGasStation HBAR balance...');
	try {
		const lgsAccountId = AccountId.fromString(lazyGasStationId.toString());
		const lgsHbarBalTinybar = await checkMirrorHbarBalance(env, lgsAccountId);
		const lgsHbarBalance = new Hbar(lgsHbarBalTinybar, HbarUnit.Tinybar);
		console.log('   Current balance:', lgsHbarBalance.toString());

		// Minimum 1 HBAR for refill operations
		const minHbarBalance = new Hbar(1, HbarUnit.Hbar);
		if (lgsHbarBalance.toTinybars() < minHbarBalance.toTinybars()) {
			// Fund with 5 HBAR
			const fundAmount = 5;
			console.log('   Balance low, funding with', fundAmount, 'HBAR...');

			const transferTx = new TransferTransaction()
				.addHbarTransfer(operatorId, Hbar.from(-fundAmount))
				.addHbarTransfer(lgsAccountId, Hbar.from(fundAmount));

			const transferSubmit = await transferTx.execute(client);
			const transferReceipt = await transferSubmit.getReceipt(client);

			if (transferReceipt.status.toString() === 'SUCCESS') {
				console.log('   ✅ LazyGasStation funded with', fundAmount, 'HBAR');
			}
			else {
				console.log('   ⚠️  Funding returned:', transferReceipt.status.toString());
			}
		}
		else {
			console.log('   ✅ LazyGasStation has sufficient HBAR balance');
		}
	}
	catch (err) {
		console.log('   ⚠️  Could not check/fund LazyGasStation:', err.message);
		console.log('   You may need to manually send HBAR to LazyGasStation:', lazyGasStationId.toString());
	}

	// Step 3: Verify deployment using mirror node (read-only, no gas cost)
	console.log('\n3️⃣  Verifying deployment...');

	try {
		// Check operator is admin
		const operatorEvmAddress = await homebrewPopulateAccountEvmAddress(env, operatorId.toString(), EntityType.ACCOUNT);
		const isAdmin = await readContract(graveyardIface, contractId, 'isAdmin', [operatorEvmAddress]);
		console.log('   Operator is admin:', isAdmin ? '✅ Yes' : '❌ No');

		// Check cost configuration - getCost() returns (lazyCost, lazyBurnPercentage)
		const [cost, burnPerc] = await readContract(graveyardIface, contractId, 'getCost', []);
		console.log('   $LAZY cost:', cost.toString());
		console.log('   Burn percentage:', burnPerc.toString() + '%');

		// Check $LAZY is associated
		const lazyEvmAddress = await homebrewPopulateAccountEvmAddress(env, lazyTokenId.toString(), EntityType.TOKEN);
		const isLazyAssoc = await readContract(graveyardIface, contractId, 'isTokenAssociated', [lazyEvmAddress]);
		console.log('   $LAZY token associated:', isLazyAssoc ? '✅ Yes' : '❌ No');
	}
	catch (err) {
		console.log('   ⚠️  Verification error:', err.message);
	}

	// Step 4: Output .env update instructions
	console.log('\n4️⃣  Update your .env file:');
	console.log('   ┌─────────────────────────────────────────────────────────────┐');
	console.log('   │ GRAVEYARD_CONTRACT_ID=' + contractId.toString().padEnd(36) + '│');
	console.log('   └─────────────────────────────────────────────────────────────┘');

	console.log('\n📝 Next Steps:');
	console.log('   1. Test CLI: node scripts/cli/info.js status');
	console.log('   2. Run tests: npm run test');
	console.log('   3. Bury some NFTs: node scripts/cli/bury.js <token> <serials>\n');

	rl.close();
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		rl.close();
		process.exit(1);
	});
