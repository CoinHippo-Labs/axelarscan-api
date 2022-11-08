const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('../index');
const {
  sleep,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );
const axelarnet =
  chains_data
    .find(c =>
      c?.id === 'axelarnet'
    );

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = async (
  params = {},
) => {
  let response;

  const {
    txHash,
    sourceChain,
    destinationChain,
    asset,
    senderAddress,
    recipientAddress,
    transferId,
    fromTime,
    from,
    size,
    sort,
  } = { ...params };
  let {
    toTime,
    query,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (txHash) {
    must.push({ match: { 'event.transactionHash': txHash } });
  }

  if (sourceChain) {
    must.push({ match: { 'event.chain': sourceChain } });
  }

  if (destinationChain) {
    must.push({ match: { 'event.returnValues.destinationChain': destinationChain } });
  }

  if (asset) {
    must.push({ match: { 'event.returnValues.asset': asset } });
  }

  if (senderAddress) {
    should.push({ match: { 'event.transaction.from': senderAddress } });
    should.push({ match: { 'event.receipt.from': senderAddress } });
  }

  if (recipientAddress) {
    must.push({ match: { 'event.returnValues.destinationAddress': recipientAddress } });
  }

  if (transferId) {
    must.push({
      bool: {
        should: [
          { match: { 'vote.transfer_id': transferId } },
          { match: { transfer_id: transferId } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (fromTime) {
    fromTime = Number(fromTime);
    toTime =
      toTime ?
        Number(toTime) :
        moment()
          .unix();

    must.push({ range: { 'event.block_timestamp': { gte: fromTime, lte: toTime } } });
  }

  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match:
          should.length > 0 ?
            1 :
            0,
      },
    };
  }

  const read_params = {
    from:
      typeof from === 'number' ?
        from :
        0,
    size:
      typeof size === 'number' ?
        size :
        100,
    sort:
      sort ||
      [{ 'event.block_timestamp': 'desc' }],
  };

  response =
    await read(
      'token_sent_events',
      query,
      read_params,
    );

  const {
    data,
  } = { ...response };

  if (
    data?.length > 0 &&
    endpoints?.api
  ) {
    const api = axios.create(
      {
        baseURL: endpoints.api,
        timeout: 5000,
      },
    );
    const _data = data
      .filter(d =>
        d?.event?.transactionHash &&
        !d.vote
      );

    for (const d of _data) {
      const {
        event,
      } = { ...d };
      const {
        transactionHash,
      } = { ...event };

      const _response =
        await read(
          'evm_polls',
          {
            match: { transaction_id: transactionHash },
          },
          {
            size: 1,
          },
        );

      const poll = _.head(_response?.data);

      const txhash =
        _.head(
          Object.entries({ ...poll })
            .filter(([k, v]) =>
              k?.startsWith(axelarnet.prefix_address) &&
              typeof v === 'object' &&
              v?.confirmed &&
              v.id
            )
            .map(([k, v]) => v.id)
        );

      if (txhash) {
        api.post(
          '',
          {
            module: 'lcd',
            path: `/cosmos/tx/v1beta1/txs/${txhash}`,
          },
        ).catch(error => { return { data: { error } }; });
      }
    }

    if (_data.length > 0) {
      await sleep(3 * 1000);
    }

    response =
      await read(
        'token_sent_events',
        query,
        read_params,
      );
  }

  if (Array.isArray(response?.data)) {
    response.data = response.data
      .map(d => {
        const {
          vote,
          sign_batch,
          ibc_send,
          axelar_transfer,
        } = { ...d };

        const status =
          ibc_send ?
            ibc_send.failed_txhash &&
            !ibc_send.ack_txhash ?
              'ibc_failed' :
              ibc_send.recv_txhash ?
                'executed' :
                'ibc_sent' :
            sign_batch?.executed ?
              'executed' :
               sign_batch ?
                'batch_signed' :
                axelar_transfer ?
                  'executed' :
                  vote ?
                    'voted' :
                    'asset_sent';

        let simplified_status;

        switch (status) {
          case 'ibc_failed':
            simplified_status = 'failed';
            break;
          case 'executed':
            simplified_status = 'received';
            break;
          case 'ibc_sent':
          case 'batch_signed':
          case 'voted':
            simplified_status = 'confirmed';
            break;
          default:
            simplified_status = 'sent';
            break;
        }

        return {
          ...d,
          status,
          simplified_status,
        };
      });
  }

  return response;
};