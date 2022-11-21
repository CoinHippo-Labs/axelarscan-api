const {
  BigNumber,
  Contract,
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  saveTimeSpent,
  update_link,
  update_source,
  normalize_link,
  _update_link,
  _update_send,
  save_time_spent,
} = require('./utils');
const lcd = require('../lcd');
const {
  read,
  write,
} = require('../index');
const {
  sleep,
  equals_ignore_case,
  get_granularity,
  getBlockTime,
  getProvider,
} = require('../../utils');
const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

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
const cosmos_non_axelarnet_chains_data =
  cosmos_chains_data
    .filter(c =>
      c?.id !== axelarnet.id
    );
const assets_data =
  require('../../data')?.assets?.[environment] ||
  [];

module.exports = async (
  params = {},
) => {
  let response;

  const {
    txHash,
    sourceChain,
    recipientAddress,
    asset,
  } = { ...params };
  let {
    depositAddress,
    query,
  } = { ...params };

  // transfer
  if (txHash) {
    const _response =
      await read(
        'transfers',
        {
          match: { 'source.id': txHash },
        },
        {
          size: 1,
        },
      );

    let data = _.head(_response?.data);

    if (!data) {
      let created_at =
        moment()
          .valueOf();

      if (txHash.startsWith('0x')) {
        for (const chain_data of evm_chains_data) {
          if (
            !sourceChain ||
            equals_ignore_case(
              chain_data?.id,
              sourceChain,
            )
          ) {
            const provider = getProvider(chain_data);

            const {
              chain_id,
            } = { ...chain_data };

            try {
              const transaction =
                await provider
                  .getTransaction(
                    txHash,
                  );

              const {
                blockNumber,
                from,
                to,
                input,
              } = { ...transaction };

              if (blockNumber) {
                const block_timestamp =
                  await getBlockTime(
                    provider,
                    blockNumber,
                  );

                if (block_timestamp) {
                  created_at = block_timestamp * 1000;
                }

                let _response;

                const receipt =
                  await provider
                    .getTransactionReceipt(
                      txHash,
                    );

                const {
                  logs,
                } = { ...receipt };

                const topics =
                  _.reverse(
                    _.cloneDeep(
                      logs ||
                      []
                    )
                    .flatMap(l =>
                      l?.topics ||
                      []
                    )
                  )
                  .filter(t =>
                    t?.startsWith('0x000000000000000000000000')
                  )
                  .map(t =>
                    t.replace(
                      '0x000000000000000000000000',
                      '0x',
                    )
                  );

                let found = false;

                for (const topic of topics) {
                  _response =
                    await read(
                      'deposit_addresses',
                      {
                        match: { deposit_address: topic },
                      },
                      {
                        size: 1,
                      },
                    );

                  if (_.head(_response?.data)) {
                    depositAddress = topic;
                    found = true;
                    break;
                  }
                }

                if (
                  !found &&
                  depositAddress
                ) {
                  _response =
                    await read(
                      'deposit_addresses',
                      {
                        match: { deposit_address: depositAddress },
                      },
                      {
                        size: 1,
                      },
                    );
                }

                if (depositAddress) {
                  const asset_data = assets_data
                    .find(a =>
                      (a?.contracts || [])
                        .findIndex(c =>
                          c?.chain_id === chain_id &&
                          equals_ignore_case(
                            c?.contract_address,
                            to,
                          )
                        ) > -1
                    );

                  const _amount =
                    _.head(
                      (logs || [])
                        .map(l => l?.data)
                        .filter(d => d?.length >= 64)
                        .map(d =>
                          d
                            .substring(
                              d.length - 64,
                            )
                            .replace(
                              '0x',
                              '',
                            )
                            .replace(
                              /^0+/,
                              '',
                            )
                        )
                        .filter(d => {
                          try {
                            d =
                              BigNumber.from(
                                `0x${d}`
                              );

                            return true;
                          } catch (error) {
                            return false;
                          }
                        })
                    );

                  let source = {
                    id: txHash,
                    type: 'evm_transfer',
                    status_code: 0,
                    status: 'success',
                    height: blockNumber,
                    created_at: get_granularity(created_at),
                    sender_chain: chain_data?.id,
                    sender_address: from,
                    recipient_address: depositAddress,
                    amount:
                      BigNumber.from(
                        `0x${
                          (transaction.data || '')
                            .substring(
                              10 + 64,
                            ) ||
                          (input.data || '')
                            .substring(
                              10 + 64,
                            ) ||
                          _amount ||
                          '0'
                        }`
                      )
                      .toString(),
                    denom: asset_data?.id,
                  };

                  let link = _.head(_response?.data);

                  link =
                    await update_link(
                      link,
                      source,
                    );

                  source =
                    await update_source(
                      source,
                      link,
                    );

                  data = {
                    source,
                    link,
                  };
                }

                break;
              }
            } catch (error) {}
          }
        }
      }
      else {
        for (const chain_data of cosmos_chains_data) {
          if (
            !sourceChain ||
            equals_ignore_case(
              chain_data?.id,
              sourceChain,
            )
          ) {
            const {
              cosmostation,
            } = { ...chain_data?.endpoints };

            const _lcds =
              _.concat(
                cosmostation,
                chain_data?.endpoints?.lcd,
                chain_data?.endpoints?.lcds,
              )
              .filter(l => l);

            let found = false;

            for (const _lcd of _lcds) {
              const lcd =
                axios.create(
                  {
                    baseURL: _lcd,
                    timeout: 3000,
                  },
                );

              const is_cosmostation = _lcd === cosmostation;

              try {
                const transaction =
                  await lcd
                    .get(
                      is_cosmostation ?
                        `/tx/hash/${txHash}` :
                        `/cosmos/tx/v1beta1/txs/${txHash}`,
                    )
                    .catch(error => {
                      return {
                        data: {
                          error,
                        },
                      };
                    });

                const tx_response =
                  is_cosmostation ?
                    transaction?.data?.data :
                    transaction?.data?.tx_response;

                const {
                  tx,
                  txhash,
                  code,
                  height,
                  timestamp,
                } = { ...tx_response };
                const {
                  messages,
                } = { ...tx?.body };

                if (messages) {
                  created_at =
                    moment(timestamp)
                      .utc()
                      .valueOf();

                  const amount_data = messages
                    .find(m =>
                      m?.token
                    )?.token;

                  let source = {
                    id: txhash,
                    type: 'ibc_transfer',
                    status_code: code,
                    status:
                      code ?
                        'failed' :
                        'success',
                    height: Number(height),
                    created_at: get_granularity(created_at),
                    sender_chain: chain_data?.id,
                    sender_address:
                      messages
                        .find(m =>
                          m?.sender
                        )?.sender,
                    recipient_address:
                      messages
                        .find(m =>
                          m?.receiver
                        )?.receiver,
                    amount: amount_data?.amount,
                    denom: amount_data?.denom,
                  };

                  const {
                    recipient_address,
                  } = { ...source };

                  if (
                    recipient_address?.length >= 65 &&
                    txhash &&
                    source.amount
                  ) {
                    const _response =
                      await read(
                        'deposit_addresses',
                        {
                          match: { deposit_address: recipient_address },
                        },
                        {
                          size: 1,
                        },
                      );

                    let link = _.head(_response?.data);

                    source =
                      await update_source(
                        source,
                        link,
                      );

                    link =
                      await update_link(
                        link,
                        source,
                        _lcd,
                      );

                    source =
                      await update_source(
                        source,
                        link,
                      );

                    data = {
                      source,
                      link,
                    };
                  }

                  found = true;
                  break;
                }
              } catch (error) {}
            }

            if (found) {
              break;
            }
          }
        }
      }
    }
    else if (data) {
      let {
        source,
      } = { ...data };
      const {
        recipient_address,
      } = { ...source };

      let _response =
        await read(
          'deposit_addresses',
          {
            match: {
              deposit_address:
                recipient_address ||
                depositAddress,
            },
          },
          {
            size: 1,
          },
        );

      let link = _.head(_response?.data);

      const {
        txhash,
        price,
      } = { ...link };

      if (
        txhash &&
        typeof price !== 'number'
      ) {
        await lcd(
          `/cosmos/tx/v1beta1/txs/${txhash}`,
        );

        await sleep(0.5 * 1000);

        _response =
          await read(
            'deposit_addresses',
            {
              match: {
                deposit_address:
                  recipient_address ||
                  depositAddress,
              },
            },
            {
              size: 1,
            },
          );

        if (_.head(_response?.data)) {
          link = _.head(_response.data);
        }
      }

      link =
        await update_link(
          link,
          source,
        );

      source =
        await update_source(
          source,
          link,
          true,
        );

      data = {
        ...data,
        source,
        link,
      };
    }

    response =
      [data]
        .filter(t => t);
  }
  else if (
    depositAddress ||
    recipientAddress
  ) {
    const _response =
      await read(
        'deposit_addresses',
        {
          bool: {
            must: [
              { match: { deposit_address: depositAddress } },
              { match: { recipient_address: recipientAddress } },
              { match: { asset } },
            ]
            .filter(m =>
              Object.values(m.match)
                .filter(v => v).length > 0
            ),
          },
        },
        {
          size: 1000,
          sort: [{ height: 'desc' }],
        },
      );

    const links =
      _response?.data ||
      [];

    if (links.length > 0) {
      const should = [];

      for (const link of links) {
        const {
          deposit_address,
        } = { ...link };

        if (
          deposit_address &&
          should
            .findIndex(s =>
              equals_ignore_case(
                s.match['source.recipient_address'],
                deposit_address,
              )
            ) < 0
        ) {
          should.push({ match: { 'source.recipient_address': deposit_address } });
        }
      }

      const _response =
        await read(
          'transfers',
          {
            bool: {
              should,
              minimum_should_match: 1,
            },
          },
          {
            size: 1000,
          },
        );

      let {
        data,
      } = { ..._response };

      if (data) {
        data =
          data
            .filter(d => d)
            .map(d => {
              const {
                recipient_address,
              } = { ...d?.source };

              return {
                ...d,
                link:
                  links
                    .find(l =>
                      equals_ignore_case(
                        l?.deposit_address,
                        recipient_address,
                      )
                    ),
              };
            });
      }

      if (!(data?.length > 0)) {
        data =
          links
            .map(l => {
              return {
                link: l,
              };
            });
      }

      response = data;
    }
    else {
      response = [];
    }
  }

  if (Array.isArray(response)) {
    response =
      response
        .map(d => {
          const {
            source,
            link,
            confirm_deposit,
            vote,
            sign_batch,
            ibc_send,
            axelar_transfer,
          } = { ...d };
          const {
            amount,
            value,
          } = { ...source };
          let {
            price,
          } = { ...link };

          if (
            typeof price !== 'number' &&
            typeof amount === 'number' &&
            typeof value === 'number'
          ) {
            price = value / amount;
          }

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
                      confirm_deposit ?
                        'deposit_confirmed' :
                        source?.status === 'failed' ?
                          'send_failed' :
                          'asset_sent';

          let simplified_status;

          switch (status) {
            case 'ibc_failed':
            case 'send_failed':
              simplified_status = 'failed';
              break;
            case 'executed':
              simplified_status = 'received';
              break;
            case 'ibc_sent':
            case 'batch_signed':
            case 'voted':
            case 'deposit_confirmed':
              simplified_status = 'approved';
              break;
            default:
              simplified_status = 'sent';
              break;
          }

          return {
            ...d,
            link:
              link &&
              {
                ...link,
                price,
              },
            status,
            simplified_status,
          };
        });

    if (response.length > 0) {
      for (const d of response) {
        const {
          source,
          confirm_deposit,
          vote,
          ibc_send,
          status,
        } = { ...d };
        let {
          sign_batch,
        } = { ...d };
        const {
          id,
          recipient_chain,
          recipient_address,
          insufficient_fee,
        } = { ...source };
        let {
          height,
        } = { ...vote };

        height =
          ibc_send?.height ||
          height ||
          confirm_deposit?.height;

        if (
          [
            'voted',
            'batch_signed',
            'ibc_sent',
          ].includes(status) &&
          !insufficient_fee &&
          vote?.id &&
          !(
            vote.transfer_id ||
            confirm_deposit?.transfer_id
          )
        ) {
          await lcd(
            `/cosmos/tx/v1beta1/txs/${vote.id}`,
          );

          await sleep(0.5 * 1000);
        }

        if (
          cosmos_chains_data
            .findIndex(c =>
              equals_ignore_case(
                c?.id,
                recipient_chain,
              )
            ) > -1 &&
          height &&
          [
            'voted',
            'deposit_confirmed',
            'ibc_sent',
          ].includes(status)
        ) {
          if (
            confirm_deposit?.id &&
            !confirm_deposit.transfer_id
          ) {
            await lcd(
              `/cosmos/tx/v1beta1/txs/${confirm_deposit.id}`,
            );

            await sleep(0.5 * 1000);
          }

          if (!insufficient_fee) {
            for (let i = 1; i <= 7; i++) {
              lcd(
                '/cosmos/tx/v1beta1/txs',
                {
                  events: `tx.height=${height + i}`,
                },
              );
            }

            await sleep(1 * 1000);
          }
        }
        else if (
          evm_chains_data
            .findIndex(c =>
              equals_ignore_case(
                c?.id,
                recipient_chain,
              )
            ) > -1 &&
          [
            'voted',
            'batch_signed',
          ].includes(status) &&
          !insufficient_fee
        ) {
          const transfer_id =
            vote?.transfer_id ||
            confirm_deposit?.transfer_id ||
            d.transfer_id;

          if (transfer_id) {
            const command_id =
              transfer_id
                .toString(16)
                .padStart(
                  64,
                  '0',
                );

            const _response =
              await read(
                'batches',
                {
                  bool: {
                    must: [
                      { match: { chain: recipient_chain } },
                      {
                        bool: {
                          should: [
                            { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                            { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } },
                          ],
                          minimum_should_match: 1,
                        },
                      },
                      { match: { command_ids: command_id } },
                    ],
                  },
                },
                {
                  size: 1,
                },
              );

            const batch = _.head(_response?.data);

            if (batch) {
              const {
                batch_id,
                commands,
                created_at,
              } = { ...batch };

              const command = (commands || [])
                .find(c =>
                  c?.id === command_id
                );

              let {
                executed,
                transactionHash,
                transactionIndex,
                logIndex,
                block_timestamp,
              } = { ...command };

              executed =
                executed ||
                !!transactionHash;

              if (!executed) {
                const chain_data = evm_chains_data
                  .find(c =>
                    equals_ignore_case(
                      c?.id,
                      recipient_chain,
                    )
                  );

                const provider = getProvider(chain_data);

                const {
                  chain_id,
                  gateway_address,
                } = { ...chain_data };

                const gateway_contract =
                  gateway_address &&
                  new Contract(
                    gateway_address,
                    IAxelarGateway.abi,
                    provider,
                  );

                try {
                  if (gateway_contract) {
                    executed =
                      await gateway_contract
                        .isCommandExecuted(
                          `0x${command_id}`,
                        );
                  }
                } catch (error) {}
              }

              if (!transactionHash) {
                const _response =
                  await read(
                    'command_events',
                    {
                      bool: {
                        must: [
                          { match: { chain: recipient_chain } },
                          { match: { command_id } },
                        ],
                      },
                    },
                    {
                      size: 1,
                    },
                  );

                const command_event = _.head(_response?.data);

                if (command_event) {
                  transactionHash = command_event.transactionHash;
                  transactionIndex = command_event.transactionIndex;
                  logIndex = command_event.logIndex;
                  block_timestamp = command_event.block_timestamp;

                  if (transactionHash) {
                    executed = true;
                  }
                }
              }

              if (
                [
                  'BATCHED_COMMANDS_STATUS_SIGNED',
                ].includes(status) ||
                executed
              ) {
                sign_batch = {
                  ...sign_batch,
                  chain: recipient_chain,
                  batch_id,
                  created_at,
                  command_id,
                  transfer_id,
                  executed,
                  transactionHash,
                  transactionIndex,
                  logIndex,
                  block_timestamp,
                };
              }
            }

            if (
              recipient_address &&
              sign_batch
            ) {
              const _id = `${id}_${recipient_address}`.toLowerCase();

              await write(
                'transfers',
                _id,
                {
                  ...d,
                  sign_batch,
                },
              );

              await saveTimeSpent(
                _id,
              );
            }
          }
        }
      }
    }
  }

  // cross-chain transfer
  /*if (txHash) {
    const _response =
      await read(
        'cross_chain_transfers',
        {
          match: { 'send.txhash': txHash },
        },
        {
          size: 1,
        },
      );

    let data =
      _.head(
        _response?.data
      );

    if (!data) {
      let created_at =
        moment()
          .valueOf();

      if (txHash.startsWith('0x')) {
        for (const chain_data of evm_chains_data) {
          if (
            !sourceChain ||
            equals_ignore_case(
              chain_data?.id,
              sourceChain,
            )
          ) {
            const {
              chain_id,
            } = { ...chain_data };

            const provider = getProvider(chain_data);

            try {
              const transaction =
                await provider
                  .getTransaction(
                    txHash,
                  );

              const {
                blockNumber,
                from,
                to,
                input,
              } = { ...transaction };

              if (blockNumber) {
                const block_timestamp =
                  await getBlockTime(
                    provider,
                    blockNumber,
                  );

                if (block_timestamp) {
                  created_at = block_timestamp * 1000;
                }

                let _response;

                const receipt =
                  await provider
                    .getTransactionReceipt(
                      txHash,
                    );

                const {
                  logs,
                } = { ...receipt };

                const topics =
                  _.reverse(
                    _.cloneDeep(
                      logs ||
                      []
                    )
                    .flatMap(l =>
                      l?.topics ||
                      []
                    )
                  )
                  .filter(t =>
                    t?.startsWith('0x000000000000000000000000')
                  )
                  .map(t =>
                    t.replace(
                      '0x000000000000000000000000',
                      '0x',
                    )
                  );

                let found = false;

                for (const topic of topics) {
                  _response =
                    await read(
                      'deposit_addresses',
                      {
                        match: { deposit_address: topic },
                      },
                      {
                        size: 1,
                      },
                    );

                  if (_.head(_response?.data)) {
                    depositAddress = topic;
                    found = true;
                    break;
                  }
                }

                if (
                  !found &&
                  depositAddress
                ) {
                  _response =
                    await read(
                      'deposit_addresses',
                      {
                        match: { deposit_address: depositAddress },
                      },
                      {
                        size: 1,
                      },
                    );
                }

                if (depositAddress) {
                  const asset_data = assets_data
                    .find(a =>
                      (a?.contracts || [])
                        .findIndex(c =>
                          c?.chain_id === chain_id &&
                          equals_ignore_case(
                            c?.contract_address,
                            to,
                          )
                        ) > -1
                    );

                  const _amount =
                    _.head(
                      (logs || [])
                        .map(l => l?.data)
                        .filter(d => d.length >= 64)
                        .map(d =>
                          d
                            .substring(
                              d.length - 64,
                            )
                            .replace(
                              '0x',
                              '',
                            )
                            .replace(
                              /^0+/,
                              '',
                            )
                        )
                        .filter(d => {
                          try {
                            d =
                              BigNumber.from(
                                `0x${d}`
                              );

                            return true;
                          } catch (error) {
                            return false;
                          }
                        })
                    );

                  const amount =
                    BigNumber.from(
                      `0x${
                        (transaction.data || '')
                          .substring(
                            10 + 64,
                          ) ||
                        (input.data || '')
                          .substring(
                            10 + 64,
                          ) ||
                        _amount ||
                        '0'
                      }`
                    )
                    .toString();

                  let send = {
                    txhash: txHash,
                    status: 'success',
                    height: blockNumber,
                    type: 'evm',
                    created_at: get_granularity(created_at),
                    source_chain: chain_data?.id,
                    sender_address: from,
                    recipient_address: depositAddress,
                    denom: asset_data?.id,
                    amount,
                  };

                  let link =
                    normalize_link(
                      _.head(
                        _response?.data
                      )
                    );

                  link =
                    await _update_link(
                      link,
                      send,
                    );

                  send =
                    await _update_send(
                      send,
                      link,
                      'deposit_address',
                    );

                  data = {
                    send,
                    link,
                  };
                }

                break;
              }
            } catch (error) {}
          }
        }
      }
      else {
        for (const chain_data of cosmos_chains_data) {
          if (
            !sourceChain ||
            equals_ignore_case(
              chain_data?.id,
              sourceChain,
            )
          ) {
            const {
              cosmostation,
            } = { ...chain_data?.endpoints };

            const _lcds =
              _.concat(
                cosmostation,
                chain_data?.endpoints?.lcd,
                chain_data?.endpoints?.lcds,
              )
              .filter(l => l);

            let found = false;

            for (const _lcd of _lcds) {
              const lcd =
                axios.create(
                  {
                    baseURL: _lcd,
                    timeout: 3000,
                  },
                );

              const is_cosmostation = _lcd === cosmostation;

              try {
                const transaction =
                  await lcd
                    .get(
                      is_cosmostation ?
                        `/tx/hash/${txHash}` :
                        `/cosmos/tx/v1beta1/txs/${txHash}`,
                    )
                    .catch(error => {
                      return {
                        data: {
                          error,
                        },
                      };
                    });

                const tx_response =
                  is_cosmostation ?
                    transaction?.data?.data :
                    transaction?.data?.tx_response;

                const {
                  tx,
                  txhash,
                  code,
                  height,
                  timestamp,
                } = { ...tx_response };
                const {
                  messages,
                } = { ...tx?.body };

                if (messages) {
                  created_at =
                    moment(timestamp)
                      .utc()
                      .valueOf();

                  const sender_address =
                    messages
                      .find(m =>
                        m?.sender
                      )?.sender;

                  const recipient_address =
                    messages
                      .find(m =>
                        m?.receiver
                      )?.receiver;

                  const amount_data = messages
                    .find(m =>
                      m?.token
                    )?.token;

                  if (
                    txhash &&
                    !code &&
                    recipient_address?.length >= 65 &&
                    amount_data?.amount
                  ) {
                    let send = {
                      txhash,
                      height: Number(height),
                      status:
                        code ?
                          'failed' :
                          'success',
                      type: 'ibc',
                      created_at: get_granularity(created_at),
                      sender_chain: chain_data?.id,
                      sender_address,
                      recipient_address,
                      denom: amount_data.denom,
                      amount: amount_data.amount,
                    };

                    const _response =
                      await read(
                        'deposit_addresses',
                        {
                          match: { deposit_address: recipient_address },
                        },
                        {
                          size: 1,
                        },
                      );

                    let link =
                      normalize_link(
                        _.head(
                          _response?.data
                        )
                      );

                    send =
                      await _update_send(
                        send,
                        link,
                        'deposit_address',
                      );

                    link =
                      await _update_link(
                        link,
                        send,
                        _lcd,
                      );

                    send =
                      await _update_send(
                        send,
                        link,
                        'deposit_address',
                      );

                    data = {
                      send,
                      link,
                    };
                  }

                  found = true;
                  break;
                }
              } catch (error) {}
            }

            if (found) {
              break;
            }
          }
        }
      }
    }
    else {
      const {
        type,
      } = { ...data };
      let {
        send,
      } = { ...data };
      const {
        recipient_address,
      } = { ...send };

      let _response =
        await read(
          'deposit_addresses',
          {
            match: {
              deposit_address:
                recipient_address ||
                depositAddress,
            },
          },
          {
            size: 1,
          },
        );

      let link =
        normalize_link(
          _.head(
            _response?.data
          )
        );

      const {
        txhash,
        price,
      } = { ...link };

      if (
        txhash &&
        typeof price !== 'number'
      ) {
        await lcd(
          `/cosmos/tx/v1beta1/txs/${txhash}`,
        );

        await sleep(0.5 * 1000);

        _response =
          await read(
            'deposit_addresses',
            {
              match: {
                deposit_address:
                  recipient_address ||
                  depositAddress,
              },
            },
            {
              size: 1,
            },
          );

        if (_.head(_response?.data)) {
          link =
            normalize_link(
              _.head(
                _response.data
              )
            );
        }
      }

      link =
        await _update_link(
          link,
          send,
        );

      send =
        await _update_send(
          send,
          link,
          recipient_address
          type,
          true,
        );

      data = {
        ...data,
        send,
        link,
      };
    }

    response =
      [data]
        .filter(t => t);
  }
  else if (
    depositAddress ||
    recipientAddress
  ) {
    const _response =
      await read(
        'deposit_addresses',
        {
          bool: {
            must: [
              { match: { deposit_address: depositAddress } },
              { match: { recipient_address: recipientAddress } },
              { match: { asset } },
            ]
            .filter(m =>
              Object.values(m.match)
                .filter(v => v)
                .length > 0
            ),
          },
        },
        {
          size: 1000,
          sort: [{ height: 'desc' }],
        },
      );

    const links =
      _response?.data ||
      [];

    if (links.length > 0) {
      const should = [];

      for (const link of links) {
        const {
          deposit_address,
        } = { ...link };

        if (
          deposit_address &&
          should
            .findIndex(s =>
              equals_ignore_case(
                s.match['send.recipient_address'],
                deposit_address,
              )
            ) < 0
        ) {
          should.push({ match: { 'send.recipient_address': deposit_address } });
        }
      }

      const _response =
        await read(
          'cross_chain_transfers',
          {
            bool: {
              should,
              minimum_should_match: 1,
            },
          },
          {
            size: 1000,
          },
        );

      let {
        data,
      } = { ..._response };

      if (Array.isArray(data)) {
        data =
          data
            .filter(d => d)
            .map(d => {
              const {
                recipient_address,
              } = { ...d?.send };

              return {
                ...d,
                link:
                  links
                    .find(l =>
                      equals_ignore_case(
                        l?.deposit_address,
                        recipient_address,
                      )
                    ),
              };
            });
      }

      if (!(data?.length > 0)) {
        data =
          links
            .map(l => {
              return {
                link: normalize_link(l),
              };
            });
      }

      response = data;
    }
    else {
      response = [];
    }
  }

  if (Array.isArray(response)) {
    response =
      response
        .map(d => {
          const {
            send,
            link,
            confirm,
            vote,
            command,
            ibc_send,
            axelar_transfer,
          } = { ...d };
          const {
            amount,
            value,
          } = { ...send };
          let {
            price,
          } = { ...link };

          if (
            typeof price !== 'number' &&
            typeof amount === 'number' &&
            typeof value === 'number'
          ) {
            price = value / amount;
          }

          const status =
            ibc_send ?
              ibc_send.failed_txhash &&
              !ibc_send.ack_txhash ?
                'ibc_failed' :
                ibc_send.recv_txhash ?
                  'executed' :
                  'ibc_sent' :
              command?.executed ?
                'executed' :
                 command ?
                  'batch_signed' :
                  axelar_transfer ?
                    'executed' :
                    vote ?
                      'voted' :
                      confirm ?
                        'deposit_confirmed' :
                        send?.status === 'failed' ?
                          'send_failed' :
                          'asset_sent';

          let simplified_status;

          switch (status) {
            case 'ibc_failed':
            case 'send_failed':
              simplified_status = 'failed';
              break;
            case 'executed':
              simplified_status = 'received';
              break;
            case 'ibc_sent':
            case 'batch_signed':
            case 'voted':
            case 'deposit_confirmed':
              simplified_status = 'approved';
              break;
            default:
              simplified_status = 'sent';
              break;
          }

          return {
            ...d,
            link:
              link &&
              {
                ...link,
                price,
              },
            status,
            simplified_status,
          };
        });

    if (response.length > 0) {
      for (const d of response) {
        const {
          send,
          confirm,
          vote,
          ibc_send,
          status,
        } = { ...d };
        let {
          command,
        } = { ...d };
        const {
          txhash,
          source_chain,
          destination_chain,
          insufficient_fee,
        } = { ...send };
        let {
          height,
        } = { ...vote };

        height =
          ibc_send?.height ||
          height ||
          confirm?.height;

        if (
          [
            'ibc_sent',
            'batch_signed',
            'voted',
          ].includes(status) &&
          !insufficient_fee &&
          vote?.txhash &&
          !(
            vote.transfer_id ||
            confirm?.transfer_id
          )
        ) {
          await lcd(
            `/cosmos/tx/v1beta1/txs/${vote.txhash}`,
          );

          await sleep(0.5 * 1000);
        }

        if (
          cosmos_chains_data
            .findIndex(c =>
              equals_ignore_case(
                c?.id,
                destination_chain,
              )
            ) > -1 &&
          height &&
          [
            'ibc_sent',
            'voted',
            'deposit_confirmed',
          ].includes(status)
        ) {
          if (
            confirm?.txhash &&
            !confirm.transfer_id
          ) {
            await lcd(
              `/cosmos/tx/v1beta1/txs/${confirm.txhash}`,
            );

            await sleep(0.5 * 1000);
          }

          if (!insufficient_fee) {
            for (let i = 1; i <= 7; i++) {
              lcd(
                '/cosmos/tx/v1beta1/txs',
                {
                  events: `tx.height=${height + i}`,
                },
              );
            }

            await sleep(1 * 1000);
          }
        }
        else if (
          evm_chains_data
            .findIndex(c =>
              equals_ignore_case(
                c?.id,
                destination_chain,
              )
            ) > -1 &&
          [
            'batch_signed',
            'voted',
          ].includes(status) &&
          !insufficient_fee
        ) {
          const transfer_id =
            vote?.transfer_id ||
            confirm?.transfer_id ||
            d.transfer_id;

          if (transfer_id) {
            const command_id =
              transfer_id
                .toString(16)
                .padStart(
                  64,
                  '0',
                );

            const _response =
              await read(
                'batches',
                {
                  bool: {
                    must: [
                      { match: { chain: destination_chain } },
                      {
                        bool: {
                          should: [
                            { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                            { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } },
                          ],
                          minimum_should_match: 1,
                        },
                      },
                      { match: { command_ids: command_id } },
                    ],
                  },
                },
                {
                  size: 1,
                },
              );

            const batch =
              _.head(
                _response?.data
              );

            if (batch) {
              const {
                batch_id,
                created_at,
                commands,
              } = { ...batch };

              const _command = (commands || [])
                .find(c =>
                  c?.id === command_id
                );

              let {
                executed,
                transactionHash,
                transactionIndex,
                logIndex,
                block_timestamp,
              } = { ..._command };

              if (!transactionHash) {
                const _response =
                  await read(
                    'command_events',
                    {
                      bool: {
                        must: [
                          { match: { chain: destination_chain } },
                          { match: { command_id } },
                        ],
                      },
                    },
                    {
                      size: 1,
                    },
                  );

                const command_event =
                  _.head(
                    _response?.data
                  );

                if (command_event) {
                  transactionHash = command_event.transactionHash;
                  transactionIndex = command_event.transactionIndex;
                  logIndex = command_event.logIndex;
                  block_timestamp = command_event.block_timestamp;

                  if (transactionHash) {
                    executed = true;
                  }
                }
              }

              executed =
                executed ||
                !!transactionHash;

              if (!executed) {
                const chain_data = evm_chains_data
                  .find(c =>
                    equals_ignore_case(
                      c?.id,
                      recipient_chain,
                    )
                  );

                const {
                  chain_id,
                  gateway_address,
                } = { ...chain_data };

                if (gateway_address) {
                  try {
                    const gateway_contract =
                      new Contract(
                        gateway_address,
                        IAxelarGateway.abi,
                        getProvider(chain_data),
                      );

                    executed =
                      await gateway_contract
                        .isCommandExecuted(
                          `0x${command_id}`,
                        );
                  } catch (error) {}
                }
              }

              if (
                [
                  'BATCHED_COMMANDS_STATUS_SIGNED',
                ].includes(status) ||
                executed
              ) {
                command = {
                  ...command,
                  chain: destination_chain,
                  command_id,
                  transfer_id,
                  batch_id,
                  created_at,
                  executed,
                  transactionHash,
                  transactionIndex,
                  logIndex,
                  block_timestamp,
                };
              }
            }

            if (
              txhash &&
              source_chain &&
              command
            ) {
              const _id = `${txhash}_${source_chain}`.toLowerCase();

              await write(
                'cross_chain_transfers',
                _id,
                {
                  ...d,
                  command,
                },
                true,
              );

              await save_time_spent(
                _id,
              );
            }
          }
        }
      }
    }
  }*/

  return response;
};