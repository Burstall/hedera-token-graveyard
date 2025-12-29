const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	ContractExecuteTransaction,
	ContractCallQuery,
	Hbar,
	TokenId,
	ContractId,
	AccountAllowanceApproveTransaction,
	TransferTransaction,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readline = require('readline');

require('dotenv').config();

let iface; // ethers Interface for ABI encoding/decoding

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

const graveyardId = process.env.GRAVEYARD_CONTRACT_ID ? ContractId.fromString(process.env.GRAVEYARD_CONTRACT_ID) : null;
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN);
const lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
const env = process.env.ENVIRONMENT ?? null;

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

function displayMenu() {
	console.log('\n╔═══════════════════════════════════════════════════════════╗');
	console.log('║       Token Graveyard v2.1 - Interactive Menu          ║');
	console.log('╚═══════════════════════════════════════════════════════════╝');
	console.log('\n📋 View Functions:');
	console.log('  1. Get cost configuration');
	console.log('  2. Check if address is admin');
	console.log('  3. Check if address is contract user');
	console.log('  4. Check if token is associated');
	console.log('  5. Get all associated tokens');
	console.log('  6. Get all admins');
	console.log('  7. Get all contract users');

	console.log('\n🔑 Admin Functions:');
	console.log('  11. Add admin');
	console.log('  12. Remove admin');
	console.log('  13. Add contract user');
	console.log('  14. Remove contract user');
	console.log('  15. Update cost');
	console.log('  16. Withdraw hbar');
	console.log('  17. Withdraw $LAZY');

	console.log('\n🪙 Token Association:');
	console.log('  21. Associate token (paid)');
	console.log('  22. Associate token (free - admin/contract user only)');

	console.log('\n⚰️  NFT Burial:');
	console.log('  31. Send NFTs directly via SDK (no royalties)');
	console.log('  32. Stake NFTs (with royalties - bypass fees)');
	console.log('  33. Stake NFTs on behalf of user (contract user only)');

	console.log('\n🔧 Utilities:');
	console.log('  41. Set $LAZY allowance to LazyGasStation');
	console.log('  42. Set NFT allowance to graveyard');

	console.log('\n  0. Exit\n');
}

const main = async () => {
	// import ABI
	const json = JSON.parse(fs.readFileSync('./artifacts/contracts/TokenGraveyard.sol/TokenGraveyard.json', 'utf8'));
	iface = new ethers.Interface(json.abi);
	console.log('✅ ABI loaded');

	if (!graveyardId) {
		console.log('❌ ERROR: GRAVEYARD_CONTRACT_ID not set in .env file');
		console.log('Please deploy the contract first: npm run deploy');
		rl.close();
		return;
	}

	console.log('Using ENVIRONMENT:', env);
	console.log('Using Operator:', operatorId.toString());

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('Connecting to *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('Connecting to *MAINNET*');
	}
	else {
		console.log('❌ ERROR: Must specify either MAIN or TEST as environment in .env file');
		rl.close();
		return;
	}

	client.setOperator(operatorId, operatorKey);

	console.log('\n📍 Contract:', graveyardId.toString());
	console.log('📍 Contract Address:', graveyardId.toSolidityAddress());

	let running = true;
	while (running) {
		displayMenu();
		const choice = await ask('Select an option: ');

		try {
			switch (choice) {
			case '1':
				await getCost();
				break;
			case '2':
				await checkIsAdmin();
				break;
			case '3':
				await checkIsContractUser();
				break;
			case '4':
				await checkTokenAssociated();
				break;
			case '5':
				await getAssociatedTokens();
				break;
			case '6':
				await getAdmins();
				break;
			case '7':
				await getContractUsers();
				break;
			case '11':
				await addAdmin();
				break;
			case '12':
				await removeAdmin();
				break;
			case '13':
				await addContractUser();
				break;
			case '14':
				await removeContractUser();
				break;
			case '15':
				await updateCost();
				break;
			case '16':
				await withdrawHbar();
				break;
			case '17':
				await withdrawLazy();
				break;
			case '21':
				await associateTokenPaid();
				break;
			case '22':
				await associateTokenFree();
				break;
			case '31':
				await sendNFTsDirect();
				break;
			case '32':
				await stakeNFTs();
				break;
			case '33':
				await stakeNFTsOnBehalf();
				break;
			case '41':
				await setLazyAllowance();
				break;
			case '42':
				await setNFTAllowance();
				break;
			case '0':
				running = false;
				console.log('\n👋 Goodbye!\n');
				break;
			default:
				console.log('❌ Invalid option. Please try again.');
			}
		}
		catch (err) {
			console.log('❌ Error:', err.message);
		}
	}

	rl.close();
};

// ============================================
// VIEW FUNCTIONS
// ============================================

async function getCost() {
	console.log('\n📊 Getting cost configuration...');
	const result = await queryContract('getCost', []);
	console.log('✅ Cost Configuration:');
	console.log('   $LAZY Cost:', result.lazyCost.toString());
	console.log('   Burn Percentage:', result.lazyBurnPercentage.toString() + '%');
}

async function checkIsAdmin() {
	const address = await ask('Enter account ID to check: ');
	const accountId = AccountId.fromString(address);
	const result = await queryContract('isAdmin', [accountId.toSolidityAddress()]);
	console.log(address, 'is admin:', result[0] ? '✅ YES' : '❌ NO');
}

async function checkIsContractUser() {
	const address = await ask('Enter account ID to check: ');
	const accountId = AccountId.fromString(address);
	const result = await queryContract('isContractUser', [accountId.toSolidityAddress()]);
	console.log(address, 'is contract user:', result[0] ? '✅ YES' : '❌ NO');
}

async function checkTokenAssociated() {
	const tokenAddress = await ask('Enter token ID to check: ');
	const tokenId = TokenId.fromString(tokenAddress);
	const result = await queryContract('isTokenAssociated', [tokenId.toSolidityAddress()]);
	console.log('Token', tokenAddress, 'is associated:', result[0] ? '✅ YES' : '❌ NO');
}

async function getAssociatedTokens() {
	console.log('\n📊 Getting associated tokens...');
	const result = await queryContract('getAssociatedTokens', []);
	console.log('✅ Associated Tokens (' + result[0].length + '):');
	result[0].forEach((token, index) => {
		try {
			const tokenId = TokenId.fromSolidityAddress(token);
			console.log(`   ${index + 1}. ${tokenId.toString()} (${token})`);
		}
		catch (err) {
			console.log(`   ${index + 1}. ${token}`);
		}
	});
}

async function getAdmins() {
	console.log('\n📊 Getting admins...');
	const result = await queryContract('getAdmins', []);
	console.log('✅ Admins (' + result[0].length + '):');
	result[0].forEach((admin, index) => {
		try {
			const accountId = AccountId.fromSolidityAddress(admin);
			console.log(`   ${index + 1}. ${accountId.toString()} (${admin})`);
		}
		catch (err) {
			console.log(`   ${index + 1}. ${admin}`);
		}
	});
}

async function getContractUsers() {
	console.log('\n📊 Getting contract users...');
	const result = await queryContract('getContractUsers', []);
	console.log('✅ Contract Users (' + result[0].length + '):');
	result[0].forEach((user, index) => {
		try {
			const accountId = AccountId.fromSolidityAddress(user);
			console.log(`   ${index + 1}. ${accountId.toString()} (${user})`);
		}
		catch (err) {
			console.log(`   ${index + 1}. ${user}`);
		}
	});
}

// ============================================
// ADMIN FUNCTIONS
// ============================================

async function addAdmin() {
	const address = await ask('Enter account ID to add as admin: ');
	const accountId = AccountId.fromString(address);
	const params = new ContractFunctionParameters()
		.addAddress(accountId.toSolidityAddress());
	await executeContract('addAdmin', params, 400_000);
	console.log('✅ Admin added:', address);
}

async function removeAdmin() {
	const address = await ask('Enter account ID to remove as admin: ');
	const accountId = AccountId.fromString(address);
	const params = new ContractFunctionParameters()
		.addAddress(accountId.toSolidityAddress());
	await executeContract('removeAdmin', params, 400_000);
	console.log('✅ Admin removed:', address);
}

async function addContractUser() {
	const address = await ask('Enter account ID to add as contract user: ');
	const accountId = AccountId.fromString(address);
	const params = new ContractFunctionParameters()
		.addAddress(accountId.toSolidityAddress());
	await executeContract('addContractUser', params, 400_000);
	console.log('✅ Contract user added:', address);
}

async function removeContractUser() {
	const address = await ask('Enter account ID to remove as contract user: ');
	const accountId = AccountId.fromString(address);
	const params = new ContractFunctionParameters()
		.addAddress(accountId.toSolidityAddress());
	await executeContract('removeContractUser', params, 400_000);
	console.log('✅ Contract user removed:', address);
}

async function updateCost() {
	const lazyCost = await ask('Enter new $LAZY cost: ');
	const burnPercentage = await ask('Enter new burn percentage (0-100): ');
	const params = new ContractFunctionParameters()
		.addUint256(lazyCost)
		.addUint256(burnPercentage);
	await executeContract('updateCost', params, 400_000);
	console.log('✅ Cost updated');
}

async function withdrawHbar() {
	const receiver = await ask('Enter receiver account ID: ');
	const amount = await ask('Enter amount in tinybars: ');
	const receiverId = AccountId.fromString(receiver);
	const params = new ContractFunctionParameters()
		.addAddress(receiverId.toSolidityAddress())
		.addUint256(amount);
	await executeContract('withdrawHbar', params, 800_000);
	console.log('✅ Hbar withdrawn');
}

async function withdrawLazy() {
	const receiver = await ask('Enter receiver account ID: ');
	const amount = await ask('Enter amount: ');
	const receiverId = AccountId.fromString(receiver);
	const params = new ContractFunctionParameters()
		.addAddress(receiverId.toSolidityAddress())
		.addUint256(amount);
	await executeContract('withdrawLazy', params, 600_000);
	console.log('✅ $LAZY withdrawn');
}

// ============================================
// TOKEN ASSOCIATION
// ============================================

async function associateTokenPaid() {
	const tokenAddress = await ask('Enter token ID to associate: ');
	const tokenId = TokenId.fromString(tokenAddress);
	console.log('⚠️  This will charge the operator account $LAZY');
	const confirm = await ask('Continue? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('Cancelled');
		return;
	}
	const params = new ContractFunctionParameters()
		.addAddress(tokenId.toSolidityAddress());
	await executeContract('associateToken', params, 800_000);
	console.log('✅ Token associated');
}

async function associateTokenFree() {
	const tokenAddress = await ask('Enter token ID to associate: ');
	const tokenId = TokenId.fromString(tokenAddress);
	const params = new ContractFunctionParameters()
		.addAddress(tokenId.toSolidityAddress());
	await executeContract('associateTokenFree', params, 800_000);
	console.log('✅ Token associated (free)');
}

// ============================================
// NFT BURIAL
// ============================================

async function sendNFTsDirect() {
	const tokenAddress = await ask('Enter NFT token ID: ');
	const serialsStr = await ask('Enter serials (comma-separated, max 10): ');
	const tokenId = TokenId.fromString(tokenAddress);
	const serials = serialsStr.split(',').map(s => parseInt(s.trim()));

	if (serials.length > 10) {
		console.log('❌ Maximum 10 NFTs per direct send (Hedera limit). Use staking (option 32) for more.');
		return;
	}

	console.log('⚠️  This will permanently send NFTs to the graveyard');
	console.log('   Token:', tokenAddress);
	console.log('   Serials:', serials.join(', '));
	console.log('   Method: Direct SDK TransferTransaction');
	const confirm = await ask('Continue? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('Cancelled');
		return;
	}

	// Check if token is associated
	const isAssociated = await queryContract('isTokenAssociated', [tokenId.toSolidityAddress()]);
	if (!isAssociated[0]) {
		console.log('📝 Token not associated with graveyard. Associating first (will charge $LAZY)...');
		const params = new ContractFunctionParameters()
			.addAddress(tokenId.toSolidityAddress());
		await executeContract('associateToken', params, 1_350_000);
		console.log('✅ Token associated');
	}

	// Send NFTs directly via SDK
	console.log('📤 Sending NFTs via TransferTransaction...');
	const graveyardAccountId = AccountId.fromString(graveyardId.toString());

	const transferTx = new TransferTransaction();
	for (const serial of serials) {
		transferTx.addNftTransfer(tokenId, serial, operatorId, graveyardAccountId);
	}

	const response = await transferTx.execute(client);
	const receipt = await response.getReceipt(client);

	console.log('Transaction status:', receipt.status.toString());
	if (receipt.status.toString() === 'SUCCESS') {
		console.log('✅ NFTs sent to graveyard');
		console.log('   Transaction ID:', response.transactionId.toString());
	}
}

async function stakeNFTs() {
	const tokenAddress = await ask('Enter NFT token ID: ');
	const serialsStr = await ask('Enter serials (comma-separated): ');
	const tokenId = TokenId.fromString(tokenAddress);
	const serials = serialsStr.split(',').map(s => parseInt(s.trim()));

	console.log('⚠️  This will permanently stake NFTs to the graveyard (bypassing royalties)');
	console.log('   Token:', tokenAddress);
	console.log('   Serials:', serials.join(', '));
	console.log('⚠️  Make sure you have set NFT allowance first (option 42)');
	const confirm = await ask('Continue? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('Cancelled');
		return;
	}

	const params = new ContractFunctionParameters()
		.addAddress(tokenId.toSolidityAddress())
		.addUint256Array(serials);
	await executeContract('stakeNFTsToTheGrave', params, 2_500_000);
	console.log('✅ NFTs staked to graveyard');
}

async function stakeNFTsOnBehalf() {
	const tokenAddress = await ask('Enter NFT token ID: ');
	const serialsStr = await ask('Enter serials (comma-separated): ');
	const owner = await ask('Enter owner account ID: ');
	const tokenId = TokenId.fromString(tokenAddress);
	const ownerId = AccountId.fromString(owner);
	const serials = serialsStr.split(',').map(s => parseInt(s.trim()));

	console.log('⚠️  This will permanently stake NFTs on behalf of:', owner);
	console.log('   Token:', tokenAddress);
	console.log('   Serials:', serials.join(', '));
	const confirm = await ask('Continue? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('Cancelled');
		return;
	}

	const params = new ContractFunctionParameters()
		.addAddress(tokenId.toSolidityAddress())
		.addUint256Array(serials)
		.addAddress(ownerId.toSolidityAddress());
	await executeContract('stakeNFTsToTheGraveOnBehalf', params, 2_500_000);
	console.log('✅ NFTs staked on behalf');
}

// ============================================
// UTILITIES
// ============================================

async function setLazyAllowance() {
	const amount = await ask('Enter allowance amount: ');
	console.log('Setting $LAZY allowance to LazyGasStation...');

	const tx = new AccountAllowanceApproveTransaction()
		.approveTokenAllowance(lazyTokenId, operatorId, lazyGasStationId, amount)
		.freezeWith(client);

	const signedTx = await tx.sign(operatorKey);
	const result = await signedTx.execute(client);
	const receipt = await result.getReceipt(client);

	console.log('✅ Allowance set:', receipt.status.toString());
}

async function setNFTAllowance() {
	const tokenAddress = await ask('Enter NFT token ID: ');
	const tokenId = TokenId.fromString(tokenAddress);
	console.log('Setting NFT allowance (all serials) to graveyard...');

	const tx = new AccountAllowanceApproveTransaction()
		.approveTokenNftAllowanceAllSerials(tokenId, operatorId, graveyardId)
		.freezeWith(client);

	const signedTx = await tx.sign(operatorKey);
	const result = await signedTx.execute(client);
	const receipt = await result.getReceipt(client);

	console.log('✅ NFT allowance set:', receipt.status.toString());
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function encodeFunctionCall(functionName, parameters) {
	const encodedData = iface.encodeFunctionData(functionName, parameters);
	return Buffer.from(encodedData.slice(2), 'hex');
}

function decodeFunctionResult(functionName, resultAsBytes) {
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const decoded = iface.decodeFunctionResult(functionName, resultHex);
	return decoded;
}

async function queryContract(functionName, parameters) {
	const functionCallAsUint8Array = encodeFunctionCall(functionName, parameters);
	const contractCall = await new ContractCallQuery()
		.setContractId(graveyardId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(100_000)
		.execute(client);

	return decodeFunctionResult(functionName, contractCall.bytes);
}

async function executeContract(functionName, params, gasLimit) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(graveyardId)
		.setGas(gasLimit)
		.setFunction(functionName, params)
		.execute(client);

	const receipt = await contractExecuteTx.getReceipt(client);
	console.log('Transaction status:', receipt.status.toString());
	return receipt;
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		rl.close();
		process.exit(1);
	});
