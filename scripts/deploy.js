const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	TokenId,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const usagecost = Number(process.env.INITIAL_COST);
const contractName = process.env.CONTRACT_NAME ?? null;
const env = process.env.ENVIRONMENT ?? null;
const lazyContractId = ContractId.fromString(process.env.LAZY_CONTRACT);
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN);
const lazyBurnPerc = process.env.LAZY_BURN_PERC || 25;

let client;

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
	const contractId = contractCreateRx.contractId;
	const contractAddress = contractId.toSolidityAddress();
	return [contractId, contractAddress];
}

const main = async () => {
	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}


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

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

	const contractBytecode = json.bytecode;

	console.log('\n- Deploying contract...', contractName);
	const gasLimit = 1_200_000;

	const [contractId, contractAddress] = await contractDeployFcn(contractBytecode, gasLimit);

	console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
