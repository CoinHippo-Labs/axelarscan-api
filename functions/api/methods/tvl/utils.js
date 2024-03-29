const { Contract, ZeroAddress, formatUnits, keccak256, toUtf8Bytes } = require('ethers');
const axios = require('axios');

const { getProvider } = require('../../utils/chain/evm');
const { getLCDs } = require('../../utils/chain/cosmos');
const { getChainData } = require('../../utils/config');
const { toBigNumber } = require('../../utils/number');
const { equalsIgnoreCase, toArray, parseRequestError } = require('../../utils');

const getTokenSupply = async (contract_data, chain) => {
  let supply;
  const { address, decimals } = { ...contract_data };
  if (address) {
    const chain_data = getChainData(chain, 'evm');
    for (const url of toArray(chain_data?.endpoints?.rpc)) {
      try {
        const rpc = axios.create({ baseURL: url });
        const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_call', params: [{ to: address, data: keccak256(toUtf8Bytes('totalSupply()')) }, 'latest'], id: 0 }).catch(error => parseRequestError(error));
        const { data } = { ...response };
        const { result } = { ...data };
        if (result) {
          supply = toBigNumber(result);
          break;
        }
      } catch (error) {}
    }
    if (!supply) {
      try {
        const provider = getProvider(chain);
        if (provider) {
          const contract = new Contract(address, ['function totalSupply() view returns (uint256)'], provider);
          supply = await contract.totalSupply();
        }
      } catch (error) {}
    }
  }
  return Number(formatUnits(supply || '0', decimals || 18));
};

const getEVMBalance = async (wallet_address, contract_data, chain) => {
  let balance;
  const { address, decimals } = { ...contract_data };
  if (wallet_address && address) {
    const chain_data = getChainData(chain, 'evm');

    for (const url of toArray(chain_data?.endpoints?.rpc)) {
      try {
        const rpc = axios.create({ baseURL: url });
        const response = await rpc.post('', { jsonrpc: '2.0', method: address === ZeroAddress ? 'eth_getBalance' : 'eth_call', params: address === ZeroAddress ? [wallet_address, 'latest'] : [{ to: address, data: `${keccak256(toUtf8Bytes('balanceOf(address)')).substring(0, 10)}000000000000000000000000${wallet_address.substring(2)}` }, 'latest'], id: 0 }).catch(error => parseRequestError(error));
        const { data } = { ...response };
        const { result } = { ...data };
        if (result) {
          balance = toBigNumber(result);
          break;
        }
      } catch (error) {}
    }
    if (!balance) {
      try {
        const provider = getProvider(chain);
        if (provider) {
          if (address === ZeroAddress) {
            balance = await provider.getBalance(wallet_address);
          }
          else {
            const contract = new Contract(address, ['function balanceOf(address owner) view returns (uint256)'], provider);
            balance = await contract.balanceOf(wallet_address);
          }
        }
      } catch (error) {}
    }
  }
  return Number(formatUnits(balance || '0', decimals || 18));
};

const getIBCSupply = async (denom_data, chain) => {
  let supply;
  const { ibc_denom, decimals } = { ...denom_data };
  const lcd = getLCDs(chain);
  if (ibc_denom && lcd) {
    let valid = false;
    if (!ibc_denom.includes('ibc/')) {
      const response = await lcd.query(`/cosmos/bank/v1beta1/supply/${encodeURIComponent(ibc_denom)}`);
      const { amount } = { ...response?.amount };
      supply = amount;
      if (supply && supply !== '0') {
        valid = true;
      }
    }
    if (!valid) {
      const response = await lcd.query('/cosmos/bank/v1beta1/supply', { 'pagination.limit': 3000 });
      supply = toArray(response?.supply).find(s => equalsIgnoreCase(s.denom, ibc_denom))?.amount;
      if (!(supply && supply !== '0') && response?.supply) {
        supply = '0';
      }
    }
  }
  return Number(formatUnits(supply || '0', decimals || 6));
};

const getCosmosBalance = async (wallet_address, denom_data, chain) => {
  let balance;
  const { denom, ibc_denom, decimals } = { ...denom_data };
  const denoms = toArray([denom, ibc_denom]);
  const lcd = getLCDs(chain);
  if (wallet_address && denoms.length > 0 && lcd) {
    let valid = false;
    for (const denom of denoms) {
      for (const path of ['/cosmos/bank/v1beta1/balances/{address}/by_denom', '/cosmos/bank/v1beta1/balances/{address}/{denom}']) {
        try {
          const response = await lcd.query(path.replace('{address}', wallet_address).replace('{denom}', encodeURIComponent(denom)), { denom });
          const { amount } = { ...response?.balance };
          balance = amount;
          if (balance/* && balance !== '0'*/) {
            valid = true;
            break;
          }
        } catch (error) {}
      }
      if (valid) {
        break;
      }
    }
  }
  return Number(formatUnits(balance || '0', decimals || 6));
};

module.exports = {
  getTokenSupply,
  getEVMBalance,
  getIBCSupply,
  getCosmosBalance,
};