module.exports = () => {
  const module = {};
  module.chainTitle = data => data?.title && data.title.split(' ').length < 3 ? data.title : data?.short_name;
  module.getChain = (id, chains) => chains?.find(c => [c?.id?.toLowerCase(), c?.maintainer_id?.toLowerCase()].includes(id?.toLowerCase()));
  module.chain_manager = {
    id: (id, chains) => module.getChain(id, chains)?.id || id,
    maintainer_id: (id, chains) => module.getChain(id, chains)?.maintainer_id || id,
    chain_id: (id, chains) => getChain(id, chains)?.chain_id,
    title: (id, chains) => module.getChain(id, chains)?.title,
    image: (id, chains) => module.getChain(id, chains)?.image,
  };
  return module;
};
