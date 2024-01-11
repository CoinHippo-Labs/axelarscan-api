const { Contract, FallbackProvider, JsonRpcProvider, ZeroAddress, keccak256, toUtf8Bytes } = require('ethers');

const { getChainData } = require('../config');
const { request } = require('../http');
const { toArray } = require('../parser');
const { toNumber, toBigNumber, formatUnits } = require('../number');

const createRPCProvider = (url, chain_id) => new JsonRpcProvider(url, chain_id ? toNumber(chain_id) : undefined);

const getProvider = (chain, _rpcs) => {
  const { chain_id, deprecated, endpoints } = { ...getChainData(chain, 'evm') };
  const rpcs = toArray(_rpcs || endpoints?.rpc);
  if (rpcs.length > 0 && !deprecated) {
    try {
      return rpcs.length > 1 ?
        new FallbackProvider(
          rpcs.map((url, i) => {
            return {
              priority: i + 1,
              provider: createRPCProvider(url, chain_id),
              stallTimeout: 1000,
              weight: 1,
            };
          }),
          chain_id,
        ) :
        createRPCProvider(rpcs[0], chain_id);
    } catch (error) {}
  }
  return null;
};

const getBalance = async (chain, address, contractData) => {
  const { rpc } = { ...getChainData(chain, 'evm')?.endpoints };
  if (!(rpc && address)) return null;

  const { decimals } = { ...contractData };
  let { contract_address } = { ...contractData };
  contract_address = contract_address || ZeroAddress;

  let balance;
  for (const url of toArray(rpc)) {
    try {
      const { result } = { ...await request(url, { method: 'post', params: { jsonrpc: '2.0', method: contract_address === ZeroAddress ? 'eth_getBalance' : 'eth_call', params: contract_address === ZeroAddress ? [address, 'latest'] : [{ to: contract_address, data: `${keccak256(toUtf8Bytes('balanceOf(address)')).substring(0, 10)}000000000000000000000000${address.substring(2)}` }, 'latest'], id: 0 } }) };
      if (result) {
        balance = toBigNumber(result);
        break;
      }
    } catch (error) {}
  }
  if (!balance) {
    try {
      const provider = getProvider(chain);
      if (contract_address === ZeroAddress) balance = await provider.getBalance(address);
      else {
        const contract = new Contract(contract_address, ['function balanceOf(address owner) view returns (uint256)'], provider);
        balance = await contract.balanceOf(address);
      }
    } catch (error) {}
  }
  return formatUnits(balance, decimals, false);
};

const getTokenSupply = async (chain, contractData) => {
  const { rpc } = { ...getChainData(chain, 'evm')?.endpoints };
  const { address, decimals } = { ...contractData };
  if (!(rpc && address)) return null;

  let supply;
  for (const url of toArray(rpc)) {
    try {
      const { result } = { ...await request(url, { method: 'post', params: { jsonrpc: '2.0', method: 'eth_call', params: [{ to: address, data: keccak256(toUtf8Bytes('totalSupply()')) }, 'latest'], id: 0 } }) };
      if (result) {
        supply = toBigNumber(result);
        break;
      }
    } catch (error) {}
  }
  if (!supply) {
    try {
      const provider = getProvider(chain);
      const contract = new Contract(address, ['function totalSupply() view returns (uint256)'], provider);
      supply = await contract.totalSupply();
    } catch (error) {}
  }
  return formatUnits(supply, decimals, false);
};

module.exports = {
  getProvider,
  getBalance,
  getTokenSupply,
};