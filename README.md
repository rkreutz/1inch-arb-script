# 1inch-arb-script

This is a simple Node.js script to try arbing a token pair on 1inch aggregator API.

## Usage

`npm install`

Then you need to create your own `.env` file: 
- Choose the base token (`FROM_TOKEN`) which you are currently holding and which all profits will be denominated on.
- Chose the token which will be paired with the base token for the arbitrage (`TO_TOKEN`)
- Add your private key (`PRIVATE_KEY`)
- Specify the RPC url for the chain you'd like to send your transactions to (`RPC_URL`)

Then just run `npm run main` and hopefully you'll be able to pick some arb opportunities.

You may wish to tweak some variables to your liking in `main.ts` as well:
- `minProfit`: the minimum profit denominated in the base token which an arb would have to yield in order to be executed. This is in nominal values (i.e. if your base token was USDC and you'd specify 100 in this field, your expected minimum profit would be 100 USDC)
- `maxGasPrice`: the maximum gas price you are willing to pay for **each** transaction (WEI denominated).
- `maxGas`: the maximum allowed gas units for **each** transaction.
- `slippage`: the slippage you'd like to use on 1inch aggregator protocol
- `pollingTime`: the time interval which the script will be polling 1inch API to check whether an arb opportunity exists or not, in **miliseconds**.
- `formattingDecimalPlaces`: how many decimal places should be shown when printing balances
- `maximumL1Fee`: how much ETH we are willing to pay for **each** transaction's calldata to be stored on L1 (WEI denominated).

### Disclaimer

This will post 2 different transactions for the arb, so there is a chance that the second transaction fails and you end up with a position on `TO_TOKEN` rather than your base token.

This script is for educational/entertainment purposes only. Use it at your own risk. By using it you agree that I will not be held responsible for any financial losses you may incur.