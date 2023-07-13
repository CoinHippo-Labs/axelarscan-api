const _ = require('lodash');
const moment = require('moment');

const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const lcd = require('../../lcd');
const { recoverEvents } = require('../../crawler');
const { BATCH_COLLECTION } = require('../../../utils/config');
const { toArray } = require('../../../utils');

const MAX_CREATED_AT_TIME_DIFF_DAYS = 7;

module.exports = async (data, params) => {
  let updated;
  if (toArray(data).length > 0) {
    updated = toArray(
      await Promise.all(
        toArray(data).map(d =>
          new Promise(
            async resolve => {
              const { chain, batch_id, status, commands } = { ...d };
              const { ms } = { ...d.created_at };
              const created_at = ms ? moment(ms).unix() : undefined;
              switch (status) {
                case 'BATCHED_COMMANDS_STATUS_SIGNED':
                case 'BATCHED_COMMANDS_STATUS_SIGNING':
                  if (moment().diff(moment(ms), 'days', true) < MAX_CREATED_AT_TIME_DIFF_DAYS && moment().diff(moment(ms), 'seconds', true) > 5) {
                    if (toArray(commands).filter(c => !c.executed).length > 0 || toArray(commands).filter(c => 'executed' in c).length < 1) {
                      const updated_batch = await lcd(`/axelar/evm/v1beta1/batched_commands/${chain}/${batch_id}`, { index: true, created_at });
                      resolve(!_.isEqual(d, updated_batch));
                    }
                  }
                default:
                  resolve(false);
                  break;
              }
            }
          )
        )
      )
    ).length > 0;

    const { sourceTransactionHash } = { ...params };
    if (sourceTransactionHash && toArray(data).length > 0) {
      const getFromBlock = async (chain, created_at) => {
        const params = {
          chain,
          status: 'has_block',
          toTime: created_at - 1,
          size: 1,
          sort: [{ 'created_at.ms': 'desc' }],
        };
        const query = generateQuery(params);
        const _params = generateReadParams(params);
        const response = await search(BATCH_COLLECTION, query, _params);
        const { commands } = { ..._.head(response?.data) };
        return _.min(toArray(toArray(commands).map(c => c.blockNumber)));
      };
      const getToBlock = async (chain, created_at) => {
        const params = {
          chain,
          status: 'has_block',
          toTime: created_at + 1,
          size: 1,
          sort: [{ 'created_at.ms': 'asc' }],
        };
        const query = generateQuery(params);
        const _params = generateReadParams(params);
        const response = await search(BATCH_COLLECTION, query, _params);
        const { commands } = { ..._.head(response?.data) };
        return _.max(toArray(toArray(commands).map(c => c.blockNumber)));
      };

      const maxBlock = 10000;
      const numRecoverPerRequest = 1000;

      await Promise.all(
        toArray(data).filter(d => d.chain && d.created_at?.ms && toArray(d.commands).findIndex(c => !c.transactionHash) > -1).map(d =>
          new Promise(
            async resolve => {
              const { chain } = { ...d };
              const { ms } = { ...d.created_at };
              const created_at = moment(ms).unix();
              const fromBlock = await getFromBlock(chain, created_at);
              const toBlock = await getFromBlock(chain, created_at);
              if (fromBlock && toBlock && fromBlock <= toBlock && toBlock - fromBlock <= maxBlock) {
                await Promise.all(
                  _.range(Math.ceil(maxBlock / numRecoverPerRequest)).map(i =>
                    new Promise(
                      async resolve => {
                        const blockNumber = fromBlock + (i * numRecoverPerRequest);
                        let toBlockNumber = blockNumber + numRecoverPerRequest - 1;
                        toBlockNumber = toBlockNumber > toBlock ? toBlock : toBlockNumber;
                        if (blockNumber <= toBlockNumber) {
                          await recoverEvents({ chain, blockNumber, toBlockNumber });
                        }
                        resolve();
                      }
                    )
                  )
                )
              }
              resolve();
            }
          )
        )
      )
    }
  }
  return updated;
};