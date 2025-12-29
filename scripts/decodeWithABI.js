const { ethers } = require('ethers');
const fs = require('fs');

/**
 * Parse parameter types from a comma-separated string, handling nested tuples.
 * Example: "address,tuple(uint32,address),string[]" => ["address", "tuple(uint32,address)", "string[]"]
 */
function parseParameterTypes(typesString) {
	const types = [];
	let current = '';
	let depth = 0;

	for (let i = 0; i < typesString.length; i++) {
		const char = typesString[i];

		if (char === '(') {
			depth++;
			current += char;
		}
		else if (char === ')') {
			depth--;
			current += char;
		}
		else if (char === ',' && depth === 0) {
			// Top-level comma, split here
			if (current.trim()) {
				types.push(current.trim());
			}
			current = '';
		}
		else {
			current += char;
		}
	}

	// Add the last type
	if (current.trim()) {
		types.push(current.trim());
	}

	return types;
}

/**
 * Extract struct definition from Solidity source code
 * Returns the struct fields as a comma-separated string or null if not found
 */
function extractStructDefinition(contractName, structName) {
	try {
		// Try multiple possible paths
		const possiblePaths = [
			`./contracts/${contractName}.sol`,
			`./contracts/interfaces/${contractName}.sol`,
			`./contracts/legacy/${contractName}.sol`,
		];

		let source = null;
		for (const path of possiblePaths) {
			if (fs.existsSync(path)) {
				source = fs.readFileSync(path, 'utf8');
				break;
			}
		}

		if (!source) {
			return null;
		}

		// Match struct declarations
		const structRegex = new RegExp(
			`struct\\s+${structName}\\s*\\{([^}]*)\\}`,
			's',
		);

		const match = structRegex.exec(source);
		if (!match) {
			return null;
		}

		// Parse struct fields
		const fieldsText = match[1];
		const fields = [];
		const lines = fieldsText.split(/[;\n]/);

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			// Remove comments
			const withoutComment = trimmed.replace(/\/\/.*$/, '').trim();
			if (!withoutComment) continue;

			// Extract type from field declaration
			const fieldMatch = withoutComment.match(/^(.+?)\s+\w+$/);
			if (fieldMatch) {
				fields.push(fieldMatch[1].trim());
			}
		}

		return fields.join(',');
	}
	catch {
		return null;
	}
}

/**
 * Recursively expand custom structs in a type string
 * Example: "NFTFeeObject[]" => "tuple(uint32,uint32,uint32,address)[]"
 */
function expandStructs(typeString, contractName, interfaceContext = null) {
	// Strip any interface/contract prefix (e.g., "IHederaTokenServiceLite.HederaToken" => "HederaToken")
	let cleanType = typeString;
	let currentInterface = interfaceContext;
	const dotMatch = typeString.match(/^([A-Za-z0-9_]+)\.([A-Z]\w+)(\[\])?$/);
	if (dotMatch) {
		cleanType = dotMatch[2] + (dotMatch[3] || '');
		// Remember the interface for nested lookups
		currentInterface = dotMatch[1];
	}

	// Check if this contains a custom struct
	const structMatch = cleanType.match(/^([A-Z]\w+)(\[\])?$/);
	if (!structMatch) {
		// Not a struct, return as-is
		return typeString;
	}

	const structName = structMatch[1];
	const isArray = structMatch[2] || '';

	// Look up the struct definition in the contract file
	let structFields = extractStructDefinition(contractName, structName);

	// If not found, try looking in the interface context or original prefix
	if (!structFields && (currentInterface || dotMatch)) {
		const interfaceName = currentInterface || dotMatch[1];
		structFields = extractStructDefinition(interfaceName, structName);
		// Keep this context for nested structs
		currentInterface = interfaceName;
	}

	if (!structFields) {
		// Struct not found, return original (may be a basic type)
		return typeString;
	}

	// Recursively expand any structs within the fields, passing along the interface context
	const expandedFields = structFields.split(',').map(field => expandStructs(field.trim(), contractName, currentInterface)).join(',');

	return `tuple(${expandedFields})${isArray}`;
}

/**
 * Extract function signature from Solidity source code
 * Returns the full function signature string or null if not found
 */
function extractFunctionSignature(contractName, functionName) {
	try {
		const solidityPath = `./contracts/${contractName}.sol`;
		if (!fs.existsSync(solidityPath)) {
			return null;
		}

		const source = fs.readFileSync(solidityPath, 'utf8');

		// Match function declarations - capture everything until the opening brace or semicolon
		const functionRegex = new RegExp(
			`function\\s+${functionName}\\s*\\([^)]*\\)(?:[^{;]*?(?:returns\\s*\\([^)]*\\))?[^{;]*?)?[{;]`,
			'gs',
		);

		const match = functionRegex.exec(source);
		if (!match) {
			return null;
		}

		// Extract just the signature part (remove implementation)
		let signature = match[0].replace(/[{;]\s*$/, '').trim();

		// Remove modifiers, visibility keywords, returns clause for our purposes
		// Keep just: function name(params)
		signature = signature.replace(/\s+(public|private|internal|external|pure|view|payable|override|virtual|returns\s*\([^)]*\))/g, '');

		return signature;
	}
	catch {
		return null;
	}
}

/**
 * Parse Solidity function signature to extract parameter types
 * Example: "function foo(address _addr, string memory _name)" => ["address", "string"]
 */
function parseSignatureToTypes(signature, contractName) {
	// Extract parameters from function signature
	const paramsMatch = signature.match(/function\s+\w+\s*\(([^)]*)\)/);
	if (!paramsMatch || !paramsMatch[1].trim()) {
		return [];
	}

	const paramsString = paramsMatch[1];
	const types = [];
	let current = '';
	let depth = 0;

	// Parse parameters, respecting nested parentheses in struct types
	for (let i = 0; i < paramsString.length; i++) {
		const char = paramsString[i];

		if (char === '(') {
			depth++;
			current += char;
		}
		else if (char === ')') {
			depth--;
			current += char;
		}
		else if (char === ',' && depth === 0) {
			// Top-level comma separating parameters
			const param = current.trim();
			if (param) {
				// Extract type (everything before the last word which is the param name)
				// Remove 'memory', 'storage', 'calldata' keywords
				const typeMatch = param.replace(/\s+(memory|storage|calldata)\s+/g, ' ')
					.match(/^(.+?)\s+\w+$/);
				if (typeMatch) {
					const rawType = typeMatch[1].trim();
					// Expand any custom structs
					types.push(expandStructs(rawType, contractName));
				}
				else {
					// No parameter name, just the type
					const rawType = param.replace(/\s+(memory|storage|calldata)/g, '').trim();
					types.push(expandStructs(rawType, contractName));
				}
			}
			current = '';
		}
		else {
			current += char;
		}
	}

	// Add the last parameter
	const param = current.trim();
	if (param) {
		const typeMatch = param.replace(/\s+(memory|storage|calldata)\s+/g, ' ')
			.match(/^(.+?)\s+\w+$/);
		if (typeMatch) {
			const rawType = typeMatch[1].trim();
			types.push(expandStructs(rawType, contractName));
		}
		else {
			const rawType = param.replace(/\s+(memory|storage|calldata)/g, '').trim();
			types.push(expandStructs(rawType, contractName));
		}
	}

	return types;
}

async function main() {
	// get arguments from the command line, ensure there are at least 2 arguments
	const args = process.argv.slice(2);
	if (args.length < 2) {
		console.log('usage: node decodeWithABI.js contract <encoded>');
		console.log('   OR: node decodeWithABI.js contract functionName <encoded>');
		console.log('   OR: node decodeWithABI.js contract --manual "type1,type2,..." <encoded>');
		console.log('example: node .\\scripts\\decodeWithABI.js MissionFactory 0x0a45aa1f0000000000000000000000000000000000000000000000000000000000000000');
		console.log('example: node .\\scripts\\decodeWithABI.js MissionFactory 0a45 aa1f 0000 0000 0000...');
		console.log('example: node .\\scripts\\decodeWithABI.js LazyLotto createPool <encoded>');
		console.log('example: node .\\scripts\\decodeWithABI.js HederaTokenService --manual "tuple(...),address[],tuple(...)" <encoded>');
		process.exit(1);
	}

	const contract = args[0];

	// Check if manual parameter types are provided
	let manualTypes = null;
	let functionName = null;
	let dataStart = 1;

	if (args[1] === '--manual' && args.length > 3) {
		manualTypes = args[2];
		dataStart = 3;
	}
	// Check if second arg looks like a function name (not hex)
	else if (args.length > 2 && !/^(0x)?[0-9a-fA-F\s]+$/.test(args[1])) {
		functionName = args[1];
		dataStart = 2;
	}

	// Join all remaining arguments and remove spaces to handle spaced-out hex bytes
	const encoded = args.slice(dataStart).join('').replace(/\s+/g, '');

	// Ensure the encoded string has 0x prefix
	const hexData = encoded.startsWith('0x') ? encoded : `0x${encoded}`;

	// Try multiple possible artifact paths
	const possibleArtifactPaths = [
		`./artifacts/contracts/${contract}.sol/${contract}.json`,
		`./artifacts/contracts/interfaces/${contract}.sol/${contract}.json`,
		`./artifacts/contracts/legacy/${contract}.sol/${contract}.json`,
	];

	let contractJSON = null;
	for (const artifactPath of possibleArtifactPaths) {
		if (fs.existsSync(artifactPath)) {
			contractJSON = JSON.parse(fs.readFileSync(artifactPath));
			break;
		}
	}

	if (!contractJSON) {
		console.error(`Could not find artifact for contract: ${contract}`);
		console.error('Searched paths:');
		possibleArtifactPaths.forEach(p => console.error(`  - ${p}`));
		console.error('\nMake sure you have compiled the contracts: npm run compile');
		process.exit(1);
	}

	const iface = new ethers.Interface(contractJSON.abi);

	try {
		let decoded;

		// If manual parameter types provided, decode directly
		if (manualTypes) {
			console.log('\n=== Manual Decode Mode ===');
			console.log('Selector in data: 0x' + hexData.slice(2, 10));
			console.log('Parameter types:', manualTypes);

			// Parse the parameter types string
			const paramTypesArray = parseParameterTypes(manualTypes);
			console.log('Parsed types:', paramTypesArray);

			const abiCoder = ethers.AbiCoder.defaultAbiCoder();
			// Skip first 4 bytes (selector)
			const paramsData = '0x' + hexData.slice(10);
			decoded = abiCoder.decode(paramTypesArray, paramsData);

			console.log('\n=== Decoded Parameters ===');
			paramTypesArray.forEach((type, index) => {
				console.log(`[${index}] (${type}):`, decoded[index]);
			});
			return;
		}

		// If function name provided, try to decode directly
		if (functionName) {
			console.log(`\n=== Decoding as function: ${functionName} ===`);

			// Try to find function in ABI first
			const func = iface.getFunction(functionName);

			if (!func) {
				// Function not in ABI - try to extract from Solidity source
				console.log('Function not found in ABI, searching Solidity source...');

				const signature = extractFunctionSignature(contract, functionName);
				if (signature) {
					console.log('Found signature:', signature);

					const paramTypes = parseSignatureToTypes(signature, contract);
					console.log('Extracted parameter types:', paramTypes);

					if (paramTypes.length > 0) {
						console.log('\nSelector in data: 0x' + hexData.slice(2, 10));

						// Try to calculate expected selector (may fail for complex interface types)
						try {
							const tempSignature = `function ${functionName}(${paramTypes.join(',')})`;
							const tempIface = new ethers.Interface([tempSignature]);
							const expectedSelector = tempIface.getFunction(functionName).selector;
							console.log('Expected selector:', expectedSelector);
						}
						catch {
							console.log('(Could not calculate selector - complex types present)');
						}

						// Decode parameters manually
						const abiCoder = ethers.AbiCoder.defaultAbiCoder();
						const paramsData = '0x' + hexData.slice(10);
						decoded = abiCoder.decode(paramTypes, paramsData);

						console.log('\n=== Decoded Parameters ===');
						paramTypes.forEach((type, index) => {
							console.log(`[${index}] (${type}):`);
							console.dir(decoded[index], { depth: 10, colors: true });
						});
						return;
					}
				}

				throw new Error(`Function ${functionName} not found in ABI or Solidity source`);
			}

			// Function found in ABI - use standard decoding
			decoded = iface.decodeFunctionData(functionName, hexData);
			console.log('Decoded parameters:');
			console.dir(decoded, { depth: 5 });

			// Also show the function signature
			console.log('\nFunction signature:');
			console.log(`  ${func.format('full')}`);
		}
		else {
			// Try to parse as a transaction first
			decoded = iface.parseTransaction({ data: hexData });

			if (decoded) {
				console.log('\n=== Decoded Transaction ===');
				console.log('Function:', decoded.name);
				console.log('Selector:', decoded.selector);
				console.dir({ args: decoded.args, fragment: decoded.fragment }, { depth: 5 });
			}
			else {
				console.log('Could not parse as transaction. Trying as error...');
				const error = iface.parseError(hexData);
				if (error) {
					console.log('\n=== Decoded Error ===');
					console.dir(error, { depth: 5 });
				}
				else {
					console.log('Could not decode data as transaction or error.');
					console.log('Hex data provided:', hexData);
					console.log('Length:', hexData.length);
				}
			}
		}
	}
	catch (error) {
		console.error('Error during decoding:');
		console.error(error.message);
		console.log('\nHex data provided:', hexData);
		console.log('Length:', hexData.length, 'characters');
		console.log('\nAvailable functions in ABI:');
		iface.forEachFunction((func) => {
			console.log(`  - ${func.name} (${func.selector})`);
		});
	}
}

main();