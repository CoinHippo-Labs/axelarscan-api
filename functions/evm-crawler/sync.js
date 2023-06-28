/***************************************************************************************
 * for manual run on local at specific environment, chain and block                    *
 * usage:                                                                              *
 *   node sync.js -e {ENVIRONMENT} -c {CHAIN} -b {FROM_BLOCK_NUMBER} {TO_BLOCK_NUMBER} *
 ***************************************************************************************/

const { Contract } = require('ethers');

const gatewaySubscriber = require('./services/gateway/subscribe');
const { getProvider } = require('./utils/provider');
const { getConfig, getChains, getChainData, getGateway } = require('./utils/config');

const IAxelarGateway = require('./data/contracts/interfaces/IAxelarGateway.json');

// setup arguments
const args = require('command-line-args')([
  {
    name: 'environment',
    alias: 'e',
    type: String,
    defaultValue: 'testnet',
  },
  {
    name: 'chain',
    alias: 'c',
    type: String,
    defaultValue: 'avalanche',
  },
  {
    name: 'block',
    alias: 'b',
    type: Number,
    multiple: true,
  },
]);

const { environment, chain, block } = { ...args };
const fromBlock = block?.[0];
const toBlock = block?.[1];
const { past_events_block_per_request } = { ...getConfig(environment) };

const sync = async () => {
  const chains_data = await getChains(environment);
  const chain_data = await getChainData(chain, chains_data, environment);
  if (chain_data) {
    const gateway_data = await getGateway(chain, undefined, environment);
    const { address } = { ...gateway_data };
    if (address) {
      const provider = await getProvider(chain, chains_data, environment);
      if (provider) {
        chain_data.provider = provider;
        chain_data.gateway = {
          ...gateway_data,
          abi: IAxelarGateway.abi,
        };
        const gateway = new Contract(address, IAxelarGateway.abi, provider);
        const filters = [gateway.filters.TokenSent(), gateway.filters.Executed()];
        /********************************************************
         * function to fetch past events emitted from contracts *
         ********************************************************/
        const run = async () => {
          // number of block per past events querying
          const num_query_block = past_events_block_per_request || 100;
          // initial blockchain query filters options data
          const options = { fromBlock, toBlock, environment };
          // flag to check whether is it query all data from specific block range
          let synced = false;

          // iterate until cover all
          while (!synced) {
            // if statement for checking & set the query filters options of each round
            if (typeof toBlock !== 'number' || typeof options.fromBlock !== 'number') {
              synced = true;
            }
            else if (toBlock - options.fromBlock >= num_query_block) {
              options.fromBlock = options.fromBlock + (options.toBlock === toBlock ? 0 : num_query_block);
              options.toBlock = options.fromBlock + num_query_block - 1;
              if (options.toBlock > toBlock) {
                options.toBlock = toBlock;
              }
            }
            else {
              options.fromBlock = options.toBlock === toBlock ? options.fromBlock : options.toBlock;
              options.toBlock = toBlock;
              synced = true;
            }
            await gatewaySubscriber.getPastEvents(chain_data, filters, options);
          }
        };
        run();
      }
    }
  }
};
sync();