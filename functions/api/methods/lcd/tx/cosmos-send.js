const _ = require('lodash');
const moment = require('moment');

const { getTransaction, getBlockTime, normalizeLink, updateLink, updateSend } = require('../../transfers/utils');
const { read } = require('../../../services/index');
const { getLCDs } = require('../../../utils/chain/cosmos');
const { DEPOSIT_ADDRESS_COLLECTION, UNWRAP_COLLECTION, getDeposits, getChainsList, getAssetData } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { equalsIgnoreCase, split, toArray, find, toJson, normalizeQuote } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  const { tx, tx_response } = { ...lcd_response };
  const { messages } = { ...tx?.body };
  const { logs } = { ...tx_response };
  const { chain_id } = { ...toArray(messages).find(m => m['@type']?.includes('MsgUpdateClient'))?.header?.signer_header?.header };

  const events = toArray(logs)
    .map(l => {
      const { events } = { ...l };
      return {
        ...toArray(events).find(e => equalsIgnoreCase(e.type, 'recv_packet')),
        height: Number(toArray(messages).find(m => _.last(toArray(m['@type'], 'normal', '.')) === 'MsgRecvPacket')?.proof_height?.revision_height || '0') - 1,
      };
    })
    .filter(e => e.height > 0 && toArray(e.attributes).length > 0)
    .map(e => {
      let { attributes } = { ...e };
      attributes = toArray(attributes).filter(a => a.key && a.value);
      const packet_data = toJson(attributes.find(a => a.key === 'packet_data')?.value);
      const packet_data_hex = attributes.find(a => a.key === 'packet_data_hex')?.value;
      const packet_sequence = attributes.find(a => a.key === 'packet_sequence')?.value;
      const packet_timeout_timestamp = attributes.find(a => a.key === 'packet_timeout_timestamp')?.value;
      return {
        ...e,
        packet_data,
        packet_data_hex,
        packet_sequence,
        packet_timeout_timestamp,
      };
    })
    .filter(e => typeof e.packet_data === 'object' && e.packet_data);

  const tx_hashes = [];
  let source_chain;

  for (const event of events) {
    const { height, packet_data, packet_data_hex, packet_sequence, packet_timeout_timestamp } = { ...event };
    const { sender } = { ...packet_data };
    const { id } = { ...getChainsList('cosmos').find(c => sender?.startsWith(c.prefix_address)) }

    const lcd = getLCDs(id);
    if (lcd) {
      let response = await lcd.query(`/cosmos/tx/v1beta1/txs?limit=5&events=send_packet.packet_sequence=${packet_sequence}&events=tx.height=${height}`);
      let { txs, tx_responses } = { ...response };
      if (toArray(tx_responses).length < 1 && packet_timeout_timestamp) {
        response = await lcd.query(`/cosmos/tx/v1beta1/txs?limit=5&events=send_packet.packet_sequence=${packet_sequence}&events=send_packet.packet_timeout_timestamp=${packet_timeout_timestamp}`);
        if (response) {
          txs = response.txs;
          tx_responses = response.tx_responses;
        }
      }
      if (toArray(tx_responses).length < 1 && packet_data_hex) {
        response = await lcd.query(`/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`send_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${height}`);
        if (response) {
          txs = response.txs;
          tx_responses = response.tx_responses;
        }
      }

      const index = toArray(tx_responses).findIndex(t => {
        const { attributes } = { ..._.head(toArray(t.logs).flatMap(l => toArray(l.events).filter(e => equalsIgnoreCase(e.type, 'send_packet')))) };
        return packet_sequence === toArray(attributes).find(a => a.key === 'packet_sequence')?.value;
      });
      if (index > -1) {
        const { tx, tx_response } = { tx: toArray(txs)[index], tx_response: toArray(tx_responses)[index] };
        const { messages } = { ...tx?.body };
        const { txhash, code, height, timestamp } = { ...tx_response };

        if (messages) {
          const { events } = { ...toArray(logs).find(l => toArray(l.events).findIndex(e => e.type === 'recv_packet' && packet_sequence === toArray(e.attributes).find(a => a.key === 'packet_sequence')?.value) > -1) };
          const { attributes } = { ...toArray(events).find(e => e.type === 'recv_packet' && packet_sequence === toArray(e.attributes).find(a => a.key === 'packet_sequence')?.value) };
          const { sender, receiver, denom, amount } = { ...toJson(toArray(attributes).find(a => a.key === 'packet_data')?.value) };

          const sender_address = toArray(messages).find(m => m.sender)?.sender || sender;
          const recipient_address = toArray(messages).find(m => m.receiver)?.receiver || receiver;
          const amount_data = toArray(messages).find(m => m.token)?.token || { denom: _.last(split(denom, 'normal', '/')), amount };

          if (txhash && !code) {
            if (recipient_address?.length >= 65 && amount_data?.amount) {
              const response = await read(
                UNWRAP_COLLECTION,
                {
                  bool: {
                    must: [
                      { match: { tx_hash: txhash } },
                      { match: { deposit_address_link: recipient_address } },
                      { match: { source_chain: id } },
                    ],
                  },
                },
                { size: 1 },
              );
              let unwrap = _.head(response?.data);

              if (unwrap?.tx_hash_unwrap) {
                const { tx_hash_unwrap, destination_chain } = { ...unwrap };
                const transaction_data = await getTransaction(tx_hash_unwrap, destination_chain);
                const { blockNumber, from } = { ...transaction_data?.transaction };
                if (blockNumber) {
                  const block_timestamp = await getBlockTime(blockNumber, destination_chain);
                  unwrap = {
                    ...unwrap,
                    height: blockNumber,
                    type: 'evm',
                    created_at: getGranularity(moment(block_timestamp * 1000).utc()),
                    sender_address: from,
                  };
                }
              }

              const send = {
                txhash,
                height: Number(height),
                status: code ? 'failed' : 'success',
                type: 'ibc',
                created_at: getGranularity(moment(timestamp).utc()),
                source_chain: id,
                sender_address,
                recipient_address,
                denom: amount_data.denom,
                amount: amount_data.amount,
              };

              const type = unwrap ? 'unwrap' : find(recipient_address, toArray(getDeposits()?.send_token?.addresses)) ? 'send_token' : 'deposit_address';
              let link;
              let transfer_id;
              if (type === 'send_token') {
                if (packet_data) {
                  const { memo } = { ...packet_data };
                  const { destination_chain, destination_address, type } = { ...toJson(memo) };
                  switch (type) {
                    case 3:
                      try {
                        link = {
                          type: destination_address?.startsWith('0x') ? 'evm' : 'axelar',
                          sender_chain: send.source_chain,
                          recipient_chain: destination_chain?.toLowerCase(),
                          sender_address: send.sender_address,
                          deposit_address: recipient_address,
                          recipient_address: destination_address,
                          denom: getAssetData(send.denom)?.denom,
                        };
                        const event_data = toArray(logs)
                          .map(l => {
                            const { events } = { ...l };
                            return { ...toArray(events).find(e => e.type.includes('TokenSent')) };
                          })
                          .filter(e => toArray(e.attributes).length > 0)
                          .map(e => {
                            let { attributes } = { ...e };
                            attributes = toArray(attributes).filter(a => a.key && a.value);
                            return Object.fromEntries(
                              attributes.map(a => {
                                const { key, value } = { ...a };
                                return [key, typeof value === 'string' ? normalizeQuote(value) : value];
                              })
                            );
                          })
                          .find(e => e.transfer_id);
                        transfer_id = !isNaN(event_data?.transfer_id) ? Number(event_data.transfer_id) : undefined;
                      } catch (error) {}
                      break;
                    default:
                      break;
                  }
                }
              }
              else {
                const _response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address: recipient_address } }, { size: 1 });
                link = normalizeLink(_.head(_response?.data));
              }
              if (link) {
                link = await updateLink(link, send);
                await updateSend(send, link, { type, unwrap: unwrap || undefined, transfer_id: transfer_id || undefined });
              }
            }

            tx_hashes.push(txhash);
            source_chain = id;
          }
        }
      }
    }
  }

  lcd_response.tx_hashes = tx_hashes;
  lcd_response.source_chain = source_chain;

  return lcd_response;
};