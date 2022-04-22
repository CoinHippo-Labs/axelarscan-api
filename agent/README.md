# Axelarscan Agent

## Deployment
### Prerequisites
Ubuntu

### clone project
```
cd $HOME
git clone https://github.com/CoinHippo-Labs/axelarscan-api.git
cd axelarscan-api/agent
git pull
```

### run setup script
```
cd $HOME/axelarscan-api/agent
bash scripts/setup.sh
```

### add user
```
adduser axelard
usermod -a -G sudo axelard
visudo
# add: axelard ALL=(ALL) NOPASSWD: ALL
```

### login
```
su axelard
```

### setup axelar node
[doc](https://docs.axelar.dev/node/join)

### start axelar node
```
cd $HOME/axelarscan-api/agent
bash scripts/axelar-core.sh --environment testnet --flags "-e docker"
```

### start prometheus
```
docker rm -f prometheus
docker run -d --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  --name prometheus \
  -p 9092:9090 \
  -v $HOME/axelarscan-api/agent/scripts/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

### start subscriber agent
```
cd $HOME/axelarscan-api/agent
docker-compose up --build -d axelarscan-agent
```

### start cli & scraper agent
```
cd $HOME/axelarscan-api/agent
rm -rf node_modules
npm i
NODE_NO_WARNINGS=1 pm2 start /home/axelard/axelarscan-api/agent/index-pm2.js -n axelarscan-agent
pm2 startup
pm2 save --force
```

### view logs
```
# subscriber agent
cd $HOME/axelarscan-api/agent
docker-compose logs -f --tail=100 axelarscan-agent

# cli & scraper agent
pm2 log --lines 100 axelarscan-agent
```

### restart services
```
# subscriber agent
cd $HOME/axelarscan-api/agent
docker-compose restart axelarscan-agent

# cli & scraper agent
pm2 reload axelarscan-agent
```