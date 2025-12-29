const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');

require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');

const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';
const env = process.env.ENVIRONMENT ?? null;
const contractName = process.env.CONTRACT_NAME ?? 'TokenGraveyard';
const eventName = process.env.EVENT_NAME ?? null;

let iface; // ethers Interface for ABI decoding

async function main() {
	console.log('Using ENVIRONMENT:', env);

	if (env === undefined || env == null) {
		console.log('Environment required, please specify TEST or MAIN in the .env file');
		return;
	}

	if (eventName === undefined || eventName == null) {
		console.log('EVENT_NAME required to decode in the .env file');
		console.log('Available events in TokenGraveyard v2.0:');
		console.log('  - NFTsBuried');
		console.log('  - TokenAssociated');
		console.log('  - RoleUpdated');
		console.log('  - CostUpdated');
		return;
	}

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	iface = new ethers.Interface(json.abi);

	const contractId = process.env.GRAVEYARD_CONTRACT_ID
		? ContractId.fromString(process.env.GRAVEYARD_CONTRACT_ID)
		: ContractId.fromString(process.env.CONTRACT_ID);

	console.log('Fetching events for contract:', contractId.toString());
	console.log('Event filter:', eventName);

	// get contract events from a mirror node
	await getEventsFromMirror(contractId);
}

/**
 * Gets all the events for a given ContractId from a mirror node
 * @param contractId
 */

async function getEventsFromMirror(contractId) {
	console.log('\n-Getting event(s) from mirror nodes...\n');

	const baseUrl = env.toUpperCase() == 'MAIN' ? baseUrlForMainnet : baseUrlForTestnet;

	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=asc`;
	console.log('Mirror URL:', url, '\n');

	axios.get(url)
		.then(function (response) {
			const jsonResponse = response.data;
			let eventCount = 0;

			jsonResponse.logs.forEach((log, index) => {
				// decode the event data
				if (log.data == '0x') return;

				try {
					const event = decodeEvent(log.data, log.topics);
					if (!event) return;

					eventCount++;
					console.log(`\n═══ Event #${eventCount} (Log Index: ${index}) ═══`);
					console.log('Timestamp:', new Date(parseFloat(log.timestamp) * 1000).toISOString());

					// Format output based on event type
					if (eventName === 'NFTsBuried') {
						const user = AccountId.fromSolidityAddress(event.user).toString();
						const token = AccountId.fromSolidityAddress(event.token).toString();
						const serials = event.serials || [];
						const viaStaking = event.viaStaking;

						console.log('User:', user);
						console.log('Token:', token);
						console.log('Serials:', serials.join(', '));
						console.log('Via Staking:', viaStaking);
					}
					else if (eventName === 'TokenAssociated') {
						const token = AccountId.fromSolidityAddress(event.token).toString();
						const paidBy = event.paidBy ? AccountId.fromSolidityAddress(event.paidBy).toString() : 'Free (Admin)';

						console.log('Token:', token);
						console.log('Paid By:', paidBy);
					}
					else if (eventName === 'RoleUpdated') {
						const user = AccountId.fromSolidityAddress(event.user).toString();
						const roleNum = event.role;
						const roleName = roleNum == 0 ? 'Admin' : 'ContractUser';
						const granted = event.granted;

						console.log('User:', user);
						console.log('Role:', roleName);
						console.log('Action:', granted ? 'GRANTED' : 'REVOKED');
					}
					else if (eventName === 'CostUpdated') {
						console.log('$LAZY Cost:', event.lazyCost);
						console.log('Burn Percentage:', event.lazyBurnPercentage + '%');
					}
					else {
						// Generic output for unknown events
						for (let f = 0; f < event.__length__; f++) {
							const field = event[f];
							let output = field;
							if (typeof field === 'string' && field.startsWith('0x')) {
								try {
									output = AccountId.fromSolidityAddress(field).toString();
								}
								catch {
									// Keep as hex if conversion fails
								}
							}
							console.log(`Field ${f}:`, output);
						}
					}
				}
				catch (err) {
					console.log(`\nError decoding log ${index}:`, err.message);
				}
			});

			console.log('\n═══════════════════════════════════════');
			console.log(`Total ${eventName} events found: ${eventCount}`);
		})
		.catch(function (err) {
			console.error('Error fetching from mirror node:', err.message);
		});
}

/**
 * Decodes event contents using the ABI definition of the event
 * @param log log data as a Hex string
 * @param topics an array of event topics (including topic0)
 */
function decodeEvent(log, topics) {
	const decoded = iface.decodeEventLog(eventName, log, topics);
	return decoded;
}

void main();