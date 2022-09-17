const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const fs = require('fs');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const usagecost = Number(process.env.INITIAL_COST);
const contractName = process.env.CONTRACT_NAME ?? null;

const client = Client.forTestnet().setOperator(operatorId, operatorKey);

async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters().addUint256(usagecost),
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

	console.log('\n-Using Operator:', operatorId);

	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

	const contractBytecode = json.bytecode;

	console.log('\n- Deploying contract...', contractName);
	const gasLimit = 800000;

	const [contractId, contractAddress] = await contractDeployFcn(contractBytecode, gasLimit);

	console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
