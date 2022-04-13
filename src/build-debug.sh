# Syntax: ./build-debug.sh
# Use --no-cache=true  when necessary
VERSION_TAG=$(<VERSION)
SERVICE_NAME=hydra-synchron-svcs
docker build -f Dockerfile.debug --no-cache=true -t $SERVICE_NAME:$VERSION_TAG .
