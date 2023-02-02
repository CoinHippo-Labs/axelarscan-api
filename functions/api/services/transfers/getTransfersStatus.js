const {
  BigNumber,
  Contract,
  constants: { AddressZero },
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  normalize_link,
  update_link,
  update_send,
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
  getTransaction,
  getBlockTime,
  getProvider,
} = require('../../utils');
const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  agent,
} = { ...config?.[environment] };

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

  // cross-chain transfers
  if (txHash) {
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
                        .filter(l =>
                          // !denom ||
                          assets_data
                            .findIndex(a =>
                              equals_ignore_case(
                                a?.id,
                                denom,
                              ) &&
                              (a?.contracts || [])
                                .findIndex(c =>
                                  c?.chain_id === chain_id &&
                                  equals_ignore_case(
                                    c?.contract_address,
                                    l?.address,
                                  )
                                ) > -1
                            ) > -1
                        )
                        .map(l =>
                          l?.data
                        )
                        .filter(d =>
                          d?.length >= 64
                        )
                        .map(d => {
                          d =
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
                              );

                          if (!d) {
                            d =
                              AddressZero
                                .replace(
                                  '0x',
                                  '',
                                );
                          }

                          return d;
                        })
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
                        _amount ||
                        (transaction.data || '')
                          .substring(
                            10 + 64,
                          ) ||
                        (input.data || '')
                          .substring(
                            10 + 64,
                          ) ||
                        '0'
                      }`
                    )
                    .toString();

                  const _response =
                    await read(
                      'unwraps',
                      {
                        bool: {
                          must: [
                            { match: { tx_hash: txHash } },
                            { match: { deposit_address_link: depositAddress } },
                            { match: { source_chain: chain_data.id } },
                          ],
                        },
                      },
                      {
                        size: 1,
                      },
                    );

                  let unwrap =
                    _.head(
                      _response?.data
                    );

                  if (unwrap) {
                    const {
                      tx_hash_unwrap,
                      destination_chain,
                    } = { ...unwrap };

                    const chain_data = evm_chains_data
                      .find(c =>
                        equals_ignore_case(
                          c?.id,
                          destination_chain,
                        )
                      );

                    if (
                      tx_hash_unwrap &&
                      chain_data
                    ) {
                      const provider = getProvider(chain_data);

                      const data =
                        await getTransaction(
                          provider,
                          tx_hash_unwrap,
                          destination_chain,
                        );

                      const {
                        blockNumber,
                        from,
                      } = { ...data?.transaction };

                      if (blockNumber) {
                        const block_timestamp =
                          await getBlockTime(
                            provider,
                            blockNumber,
                          );

                        unwrap = {
                          ...unwrap,
                          height: blockNumber,
                          type: 'evm',
                          created_at:
                            get_granularity(
                              moment(
                                block_timestamp * 1000
                              )
                              .utc()
                            ),
                          sender_address: from,
                        };
                      }
                    }
                  }

                  const type =
                    unwrap ?
                      'unwrap' :
                      'deposit_address';

                  const _data = {
                    type,
                    unwrap:
                      unwrap ||
                      undefined,
                  };

                  try {
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
                      await update_link(
                        link,
                        send,
                      );

                    send =
                      await update_send(
                        send,
                        link,
                        _data,
                      );

                    data = {
                      send,
                      link,
                      ..._data,
                    };
                  } catch (error) {}
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
              endpoints,
            } = { ...chain_data };
            const {
              cosmostation,
              lcds,
            } = { ...endpoints };

            const _lcds =
              _.concat(
                cosmostation,
                lcds,
              )
              .filter(l => l);

            let found = false;

            for (const _lcd of _lcds) {
              const lcd =
                axios.create(
                  {
                    baseURL: _lcd,
                    timeout: 3000,
                    headers: {
                      agent,
                      'Accept-Encoding': 'gzip',
                    },
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

                  const amount_data =
                    messages
                      .find(m =>
                        m?.token
                      )?.token;

                  if (
                    txhash &&
                    !code &&
                    recipient_address?.length >= 65 &&
                    amount_data?.amount
                  ) {
                    const _response =
                      await read(
                        'unwraps',
                        {
                          bool: {
                            must: [
                              { match: { tx_hash: txhash } },
                              { match: { deposit_address_link: recipient_address } },
                              { match: { source_chain: chain_data.id } },
                            ],
                          },
                        },
                        {
                          size: 1,
                        },
                      );

                    let unwrap =
                      _.head(
                        _response?.data
                      );

                    if (unwrap) {
                      const {
                        tx_hash_unwrap,
                        destination_chain,
                      } = { ...unwrap };

                      const chain_data = evm_chains_data
                        .find(c =>
                          equals_ignore_case(
                            c?.id,
                            destination_chain,
                          )
                        );

                      if (
                        tx_hash_unwrap &&
                        chain_data
                      ) {
                        const provider = getProvider(chain_data);

                        const data =
                          await getTransaction(
                            provider,
                            tx_hash_unwrap,
                            destination_chain,
                          );

                        const {
                          blockNumber,
                          from,
                        } = { ...data?.transaction };

                        if (blockNumber) {
                          const block_timestamp =
                            await getBlockTime(
                              provider,
                              blockNumber,
                            );

                          unwrap = {
                            ...unwrap,
                            height: blockNumber,
                            type: 'evm',
                            created_at:
                              get_granularity(
                                moment(
                                  block_timestamp * 1000
                                )
                                .utc()
                              ),
                            sender_address: from,
                          };
                        }
                      }
                    }

                    const type =
                      unwrap ?
                        'unwrap' :
                        'deposit_address';

                    const _data = {
                      type,
                      unwrap:
                        unwrap ||
                        undefined,
                    };

                    try {
                      let send = {
                        txhash,
                        height: Number(height),
                        status:
                          code ?
                            'failed' :
                            'success',
                        type: 'ibc',
                        created_at: get_granularity(created_at),
                        source_chain: chain_data?.id,
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
                        await update_send(
                          send,
                          link,
                          _data,
                        );

                      link =
                        await update_link(
                          link,
                          send,
                          _lcd,
                        );

                      send =
                        await update_send(
                          send,
                          link,
                          _data,
                        );

                      data = {
                        send,
                        link,
                        ..._data,
                      };
                    } catch (error) {}
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
      let {
        type,
        send,
        vote,
        command,
        ibc_send,
        axelar_transfer,
        wrap,
      } = { ...data };
      const {
        txhash,
        source_chain,
        recipient_address,
      } = { ...send };

      // resolve unwrap
      const _response =
        await read(
          'unwraps',
          {
            bool: {
              must: [
                { match: { tx_hash: txhash } },
                { match: { deposit_address_link: recipient_address } },
                { match: { source_chain } },
              ],
            },
          },
          {
            size: 1,
          },
        );

      let unwrap =
        _.head(
          _response?.data
        );

      if (unwrap) {
        const {
          tx_hash_unwrap,
          destination_chain,
        } = { ...unwrap };

        const chain_data = evm_chains_data
          .find(c =>
            equals_ignore_case(
              c?.id,
              destination_chain,
            )
          );

        if (
          tx_hash_unwrap &&
          chain_data
        ) {
          const provider = getProvider(chain_data);

          const data =
            await getTransaction(
              provider,
              tx_hash_unwrap,
              destination_chain,
            );

          const {
            blockNumber,
            from,
          } = { ...data?.transaction };

          if (blockNumber) {
            const block_timestamp =
              await getBlockTime(
                provider,
                blockNumber,
              );

            unwrap = {
              ...unwrap,
              height: blockNumber,
              type: 'evm',
              created_at:
                get_granularity(
                  moment(
                    block_timestamp * 1000
                  )
                  .utc()
                ),
              sender_address: from,
            };
          }
        }
      }

      type =
        unwrap ?
          'unwrap' :
          wrap ?
            'wrap' :
            type ||
            'deposit_address';

      const _data = {
        type,
        unwrap:
          unwrap ||
          undefined,
      };

      // resolve vote
      try {
        if (
          txhash &&
          evm_chains_data
            .findIndex(c =>
              equals_ignore_case(
                c?.id,
                source_chain,
              )
            ) > -1 &&
          !vote &&
          (
            command ||
            ibc_send ||
            axelar_transfer
          )
        ) {
          const _response =
            await read(
              'evm_polls',
              {
                bool: {
                  must: [
                    { match: { transaction_id: txhash } },
                    { match: { sender_chain: source_chain } },
                  ],
                  should: [
                    { match: { confirmation: true } },
                    { match: { success: true } },
                  ],
                  minimum_should_match: 1,
                },
              },
              {
                size: 1,
              },
            );

          const poll_data =
            _.head(
              _response?.data
            );

          if (poll_data) {
            const vote_confirmation =
              _.head(
                Object.values(poll_data)
                  .filter(v =>
                    v?.confirmed
                  )
              );

            if (vote_confirmation) {
              const {
                id,
                height,
                created_at,
                sender_chain,
                recipient_chain,
                transaction_id,
                deposit_address,
                transfer_id,
                event,
                confirmation,
                success,
                failed,
                unconfirmed,
                late,
              } = { ...poll_data };
              const {
                type,
              } = { ...vote_confirmation };

              _data.vote =
                {
                  txhash: vote_confirmation?.id,
                  height,
                  status: 'success',
                  type,
                  created_at,
                  source_chain: sender_chain,
                  destination_chain: recipient_chain,
                  poll_id: id,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  event,
                  confirmation,
                  success,
                  failed,
                  unconfirmed,
                  late,
                };
            }
          }
        }
      } catch (error) {}

      // remove link & send
      try {
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
          await update_link(
            link,
            send,
          );

        send =
          await update_send(
            send,
            link,
            _data,
            true,
          );

        data = {
          ...data,
          send,
          link,
          ..._data,
        };
      } catch (error) {}
    }

    response =
      [
        data,
      ]
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
            wrap,
            unwrap,
          } = { ...d };
          let {
            type,
          } = { ...d };
          const {
            amount,
            value,
          } = { ...send };
          let {
            price,
          } = { ...link };

          type =
            wrap ?
              'wrap' :
              unwrap ?
                'unwrap' :
                type;

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
                ibc_send.recv_txhash ||
                unwrap ?
                  'executed' :
                  'ibc_sent' :
              command?.executed ||
              unwrap ?
                'executed' :
                 command ?
                  'batch_signed' :
                  axelar_transfer ||
                  unwrap ?
                    'executed' :
                    vote ?
                      'voted' :
                      confirm ?
                        'deposit_confirmed' :
                        send?.status === 'failed' &&
                        !wrap ?
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
            type,
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

            await sleep(3 * 1000);
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
  }

  return response;
};