Token Graveyard Solidity using HTS deployed on Hedera

Check-out the repo:

### install dependencies ###
npm install

### Setup .env file ###
ENVIRONMENT=TEST
CONTRACT_NAME=TokenGraveyard
EVENT_NAME=GraveyardEvent
ACCOUNT_ID=
PRIVATE_KEY=
##cost in tiny bar (10^8)
INITIAL_COST=

### launch unit tests - please use testnet details ###
npm run test

### interact wih deployed script ###
updates .env:
CONTRACT_ID=
TOKEN_ID=

npm run interact

get logs (emitted events)
npm run logs

decode last error on contract (args: testnet/mainnet and contract ID)
node scripts/decodeSmartContractError.js testnet 0.0.48280144

### deploy to mainnet
update .env for main
npm run deploy

### run solhint ###
npm run solhint
