const fixValues = require('./fix-values');
const fixConfirms = require('./fix-confirms');
const fixTerraToClassic = require('./fix-terra-to-classic');
const {
  API,
  getTransfers,
} = require('./api');
const {
  sleep,
} = require('../../utils');

module.exports = async (
  collection = 'cross_chain_transfers',
) => {
  const api = API();

  fixValues();
  fixConfirms();
  fixTerraToClassic();

  while (true) {
    const response =
      await getTransfers(
        {
          status: 'to_migrate',
          size: 10,
          sort: [{ 'source.created_at.ms': 'asc' }],
        },
        '/cross-chain/_transfers',
      );

    const {
      data,
    } = { ...response };

    if (
      Array.isArray(data) &&
      data.length > 0
    ) {
      for (const d of data) {
        const {
          source,
          link,
          confirm_deposit,
          vote,
          sign_batch,
          ibc_send,
          axelar_transfer,
        } = { ...d };

        if (
          source?.id &&
          source.sender_chain
        ) {
          const _d = {
            send: {
              txhash: source.id,
              height: Number(source.height),
              status: source.status,
              type:
                source.type?.replace(
                  '_transfer',
                  '',
                ),
              created_at: source.created_at,
              original_source_chain: source.original_sender_chain,
              original_destination_chain: source.original_recipient_chain,
              source_chain: source.sender_chain,
              destination_chain: source.recipient_chain,
              sender_address: source.sender_address,
              recipient_address: source.recipient_address,
              denom: source.denom,
              amount: source.amount,
              amount_received: source.amount_received,
              fee: source.fee,
              insufficient_fee: source.insufficient_fee,
              value:
                source.value ||
                (
                  typeof source.amount === 'number' &&
                  typeof link?.price === 'number' ?
                    source.amount * link.price :
                    undefined
                ),
            },
            link:
              (
                link &&
                {
                  txhash: link.txhash,
                  height: link.height,
                  type: link.type,
                  created_at: link.created_at,
                  original_source_chain: link.original_sender_chain,
                  original_destination_chain: link.original_recipient_chain,
                  source_chain: link.sender_chain,
                  destination_chain: link.recipient_chain,
                  sender_address: link.sender_address,
                  deposit_address: link.deposit_address,
                  recipient_address: link.recipient_address,
                  denom: link.denom,
                  asset: link.asset,
                  price: link.price,
                }
              ) ||
              undefined,
            confirm:
              (
                confirm_deposit &&
                {
                  txhash: confirm_deposit.id,
                  height: confirm_deposit.height,
                  status: confirm_deposit.status,
                  type: confirm_deposit.type,
                  created_at: confirm_deposit.created_at,
                  source_chain: confirm_deposit.sender_chain,
                  destination_chain: confirm_deposit.recipient_chain,
                  deposit_address: confirm_deposit.deposit_address,
                  token_address: confirm_deposit.token_address,
                  denom: confirm_deposit.denom,
                  amount: confirm_deposit.amount,
                  poll_id: confirm_deposit.poll_id,
                  transfer_id: confirm_deposit.transfer_id,
                  transaction_id: confirm_deposit.transaction_id,
                  participants: confirm_deposit.participants,
                }
              ) ||
              undefined,
            vote:
              (
                vote &&
                {
                  txhash: vote.id,
                  height: vote.height,
                  status: vote.status,
                  type: vote.type,
                  created_at: vote.created_at,
                  source_chain: vote.sender_chain,
                  destination_chain: vote.recipient_chain,
                  poll_id: vote.poll_id,
                  transaction_id: vote.transaction_id,
                  deposit_address: vote.deposit_address,
                  transfer_id: vote.transfer_id,
                  event: vote.event,
                  confirmation: vote.confirmation,
                  success: vote.success,
                  failed: vote.failed,
                  unconfirmed: vote.unconfirmed,
                  late: vote.late,
                }
              ) ||
              undefined,
            command:
              (
                sign_batch &&
                {
                  chain: sign_batch.chain,
                  command_id: sign_batch.command_id,
                  transfer_id: sign_batch.transfer_id,
                  batch_id: sign_batch.batch_id,
                  created_at: sign_batch.created_at,
                  executed: sign_batch.executed,
                  transactionHash: sign_batch.transactionHash,
                  transactionIndex: sign_batch.transactionIndex,
                  logIndex: sign_batch.logIndex,
                  block_timestamp: sign_batch.block_timestamp,
                }
              ) ||
              undefined,
            ibc_send:
              (
                ibc_send &&
                {
                  txhash: ibc_send.id,
                  failed_txhash: ibc_send.failed_txhash,
                  ack_txhash: ibc_send.ack_txhash,
                  recv_txhash: ibc_send.recv_txhash,
                  received_at: ibc_send.received_at,
                  height: ibc_send.height,
                  status: ibc_send.status,
                  type: ibc_send.type,
                  created_at: ibc_send.created_at,
                  sender_address: ibc_send.sender_address,
                  recipient_address: ibc_send.recipient_address,
                  denom: ibc_send.denom,
                  amount: ibc_send.amount,
                  transfer_id: ibc_send.transfer_id,
                  packet: ibc_send.packet,
                }
              ) ||
              undefined,
            axelar_transfer:
              (
                axelar_transfer &&
                {
                  txhash: axelar_transfer.id,
                  height: axelar_transfer.height,
                  status: axelar_transfer.status,
                  type: 'axelar',
                  created_at: axelar_transfer.created_at,
                  destination_chain: axelar_transfer.recipient_chain,
                  recipient_address: axelar_transfer.recipient_address,
                  denom: axelar_transfer.denom,
                  amount: axelar_transfer.amount,
                  transfer_id: axelar_transfer.transfer_id,
                }
              ) ||
              undefined,
          };

          const fields =
            [
              'send',
              'link',
            ];

          for (const f of fields) {
            if (_d[f]) {
              const {
                send,
              } = { ..._d };
              const {
                height,
                created_at,
              } = { ...send };
              const {
                ms,
                year,
              } = { ...created_at };

              if (
                height > 1000000 &&
                ms < 1659712921000 &&
                year === 1640995200000
              ) {
                const sub_fields =
                [
                  'original_source_chain',
                  'source_chain',
                ];

                for (const _f of sub_fields) {
                  if (
                    [
                      'terra-2',
                    ].includes(_d[f][_f])
                  ) {
                    _d[f][_f] = 'terra';
                  }
                }
              }
            }
          }

          const _id = `${_d.send.txhash}_${_d.send.source_chain}`.toLowerCase();

          await api
            .post(
              '',
              {
                module: 'index',
                method: 'set',
                collection,
                id: _id,
                path: `/${collection}/_update/${_id}`,
                update_only: true,
                ..._d,
              },
            )
            .catch(error => {
              return {
                data: {
                  error,
                },
              };
            });
        }
      }
    }
    else {
      await sleep(3 * 1000);
    }
  }
};