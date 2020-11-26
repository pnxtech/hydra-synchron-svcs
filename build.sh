# Syntax: ./build.sh
# Use --no-cache=true  when necessary
VERSION_TAG=$(<VERSION)
docker build -t hydra-synchron-svcs:$VERSION_TAG .
