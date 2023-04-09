# Axelarscan Agent

## Deployment
### Prerequisites
Ubuntu

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
### clone project
```
cd $HOME
git clone https://github.com/CoinHippo-Labs/axelarscan-api.git
cd axelarscan-api/agent
git pull
```
### run setup script
```
bash $HOME/axelarscan-api/agent/scripts/setup.sh
```

### start axelar node (Binary)
```
bash $HOME/axelarscan-api/agent/scripts/axelar-core.sh --environment testnet
```
### start subscriber agent
```
cd $HOME/axelarscan-api/agent
docker-compose up --build -d axelarscan-agent
```
### view logs
```
cd $HOME/axelarscan-api/agent
docker-compose logs -f --tail=100 axelarscan-agent
```
### restart services
```
cd $HOME/axelarscan-api/agent
docker-compose restart axelarscan-agent
```
