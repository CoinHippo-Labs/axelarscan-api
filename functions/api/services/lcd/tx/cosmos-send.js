const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('../../index');
const {
  update_link,
  update_source,
} = require('../../transfers/utils');
const {
  equals_ignore_case,
  get_granularity,
  to_json,
} = require('../../../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data = require('../../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_response,
    tx,
  } = { ...lcd_response };

  try {
    const {
      logs,
    } = { ...tx_response };
    const {
      messages,
    } = { ...tx?.body };

    const {
      chain_id,
    } = {
      ...messages.find(m =>
        m?.['@type']?.includes('MsgUpdateClient')
      )?.header?.signer_header?.header,
    };

    const recv_packets = (logs || [])
      .map(l => {
        const {
          events,
        } = { ...l };

        return {
          ...events?.find(e =>
            equals_ignore_case(e?.type, 'recv_packet')
          ),
          height: Number(
            messages.find(m =>
              _.last(
                (m?.['@type'] || '')
                  .split('.')
              ) === 'MsgRecvPacket'
            )?.proof_height?.revision_height ||
            '0'
          ) - 1,
        };
      })
      .filter(e =>
        e.height > 0 &&
        e.attributes?.length > 0
      )
      .map(e => {
        let {
          attributes,
        } = { ...e };

        attributes = attributes
          .filter(a =>
            a?.key &&
            a.value
          );

        const packet_data = to_json(
          attributes.find(a =>
            a?.key === 'packet_data'
          )?.value
        );

        const packet_data_hex =
          attributes.find(a =>
            a?.key === 'packet_data_hex'
          )?.value;

        const packet_sequence =
          attributes.find(a =>
            a?.key === 'packet_sequence'
          )?.value;

        return {
          ...e,
          packet_data,
          packet_data_hex,
          packet_sequence,
        };
      })
      .filter(e =>
        typeof e.packet_data === 'object' &&
        e.packet_data
      );

    for (const record of recv_packets) {
      const {
        height,
        packet_data,
        packet_data_hex,
        packet_sequence,
      } = { ...record };

      for (const chain_data of cosmos_chains_data) {
        const {
          prefix_address,
        } = { ...chain_data };

        if (packet_data.sender?.startsWith(prefix_address)) {
          let found = false;

          const _lcds =
            _.concat(
              chain_data?.endpoints?.lcd,
              chain_data?.endpoints?.lcds,
            )
            .filter(l => l);

          for (const _lcd of _lcds) {
            const lcd = axios.create(
              {
                baseURL: _lcd,
                timeout: 1500,
              },
            );

            let _response = await lcd.get(
              `/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`send_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${height}`,
            ).catch(error => { return { data: { error } }; });

            let {
              tx_responses,
              txs,
            } = { ..._response?.data };

            if (tx_responses?.length < 1) {
              _response = await lcd.get(
                `/cosmos/tx/v1beta1/txs?limit=5&events=send_packet.packet_sequence=${packet_sequence}&events=tx.height=${height}`,
              ).catch(error => { return { data: { error } }; });

              if (_response?.data) {
                tx_responses = _response.data.tx_responses;
                txs = _response.data.txs;
              }
            }

            const index = (tx_responses || [])
              .findIndex(t => {
                const send_packet = _.head(
                  (t?.logs || [])
                    .flatMap(l =>
                      (l?.events || [])
                        .filter(e =>
                          equals_ignore_case(e?.type, 'send_packet')
                        )
                    )
                );

                const {
                  attributes,
                } = { ...send_packet };

                return (
                  packet_sequence === (
                    attributes?.find(a =>
                      a?.key === 'packet_sequence'
                    )?.value
                  )
                );
              });

            if (index > -1) {
              const _data = {
                ...tx_responses[index],
                tx: {
                  ...txs?.[index],
                },
              };

              const {
                txhash,
                code,
                height,
                timestamp,
              } = { ..._data };
              const {
                messages,
              } = { ..._data.tx.body };

              if (messages) {
                const created_at = moment(timestamp)
                  .utc()
                  .valueOf();

                const amount_data =
                  messages.find(m =>
                    m?.token
                  )?.token;

                let _record = {
                  id: txhash,
                  type: 'ibc_transfer',
                  status_code: code,
                  status: code ?
                    'failed' :
                    'success',
                  height,
                  created_at: get_granularity(created_at),
                  sender_chain: chain_data.id,
                  sender_address: messages.find(m =>
                    m?.sender
                  )?.sender,
                  recipient_address: messages.find(m =>
                    m?.receiver
                  )?.receiver,
                  amount: amount_data?.amount,
                  denom: amount_data?.denom,
                };

                const {
                  recipient_address,
                } = { ..._record };
                let {
                  amount,
                } = { ..._record };

                if (
                  recipient_address?.length >= 65 &&
                  txhash &&
                  amount
                ) {
                  const _response = await read(
                    'deposit_addresses',
                    {
                      match: { deposit_address: recipient_address },
                    },
                    {
                      size: 1,
                    },
                  );

                  let link = _.head(_response?.data);

                  link = await update_link(
                    link,
                    _record,
                    _lcd,
                  );

                  _record = await update_source(
                    _record,
                    link,
                  );

                  found = true;
                  break;
                }
              }
            }
          }

          if (found) {
            break;
          }
        }
      }
    }
  } catch (error) {}
};